import { ops, userClient, type RepoSlice } from "./db.ts";
import {
  githubCommit,
  githubCommitPage,
  githubCommitView,
  githubCommits,
  githubContents,
  githubCreateHook,
  githubLanguages,
  githubMessage,
  githubReadmeHtml,
  githubRepo,
  githubUser,
  isDeployKey,
  safeRepoPath,
  type ListedCommit,
} from "./github.ts";
import { env } from "./env.ts";
import { sanitize } from "./http.ts";

export type SliceOutcome = { pending: boolean } | { already_running: true };

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mapFiles(files: { filename: string; status: string; additions?: number; deletions?: number }[]) {
  const truncated = files.length > 100;
  return {
    files: files.slice(0, 100).map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions ?? null,
      deletions: file.deletions ?? null,
    })),
    files_truncated: truncated,
    files_changed: files.length,
  };
}

async function toStoredCommit(token: string, fullName: string, item: ListedCommit) {
  const detail = await githubCommit(token, fullName, item.sha);
  const files = mapFiles(detail.files);
  return {
    sha: item.sha,
    message: item.commit.message,
    author_name: item.commit.author?.name ?? null,
    author_login: item.author?.login ?? null,
    committed_at: item.commit.author?.date ?? new Date().toISOString(),
    additions: detail.additions,
    deletions: detail.deletions,
    files_changed: files.files_changed,
    files_truncated: files.files_truncated,
    files: files.files,
  };
}

async function syncPage(token: string, repo: RepoSlice, commitCount: number) {
  if (!repo.backfill_done && commitCount >= repo.history_limit) {
    await ops.patchRepository(repo.id, {
      backfill_done: true,
      sync_status: "idle",
      sync_error: null,
      last_remote_check_at: new Date().toISOString(),
    });
    return 0;
  }

  const page = repo.backfill_done ? repo.incremental_page : repo.backfill_page;
  const listed = await githubCommits(token, repo.full_name, page, repo.history_since);
  if (repo.backfill_done && page === 1 && listed[0]) {
    await ops.patchRepository(repo.id, { pending_tip_sha: listed[0].sha });
    repo.pending_tip_sha = listed[0].sha;
  }

  const caughtUp = repo.backfill_done && listed.some((item) => item.sha === repo.last_synced_sha);
  const room = Math.max(repo.history_limit - commitCount, 0);
  const stored = [];
  for (const item of listed) {
    if (repo.backfill_done && item.sha === repo.last_synced_sha) break;
    if (!repo.backfill_done && stored.length >= room) break;
    stored.push(await toStoredCommit(token, repo.full_name, item));
  }
  const added = stored.length ? await ops.saveCommits(repo.id, stored) : 0;

  if (page === 1) {
    const languages = await githubLanguages(token, repo.full_name);
    await ops.saveLanguages(repo.id, languages);
  }

  const reachedLimit = !repo.backfill_done && commitCount + added >= repo.history_limit;
  const shortPage = listed.length < 20;
  const done = repo.backfill_done || reachedLimit || shortPage || caughtUp;
  const patch: Record<string, unknown> = {
    sync_status: "idle",
    sync_error: null,
    last_remote_check_at: new Date().toISOString(),
  };

  if (!repo.backfill_done) {
    patch.backfill_done = done;
    patch.backfill_page = done ? repo.backfill_page : repo.backfill_page + 1;
    if (done && listed[0]) patch.last_synced_sha = listed[0].sha;
  } else if (caughtUp || shortPage) {
    patch.incremental_page = 1;
    patch.last_synced_sha = repo.pending_tip_sha ?? listed[0]?.sha ?? repo.last_synced_sha;
    patch.pending_tip_sha = null;
  } else {
    patch.incremental_page = repo.incremental_page + 1;
  }

  await ops.patchRepository(repo.id, patch);
  return added;
}

export async function runSlice(trigger: "reconcile" | "manual", repositoryId: string | null): Promise<SliceOutcome> {
  const acquired = await ops.acquireSlice(trigger, repositoryId);
  if ("already_running" in acquired) return { already_running: true };
  if ("empty" in acquired) return { pending: false };

  let added = 0;
  let failure: string | null = null;
  try {
    const token = await ops.token(acquired.repository.connection_id);
    added = await syncPage(token, acquired.repository, acquired.commit_count);
  } catch (error) {
    failure = githubMessage(error);
    await ops.patchRepository(acquired.repository.id, { sync_status: "error", sync_error: failure });
  }

  const remaining = await ops.remaining();
  await ops.finishSlice(
    acquired.run_id,
    failure ? "error" : "ok",
    remaining > 0,
    remaining,
    added,
    failure,
  );
  return { pending: remaining > 0 };
}

export async function connectRepository(connectionId: string, fullName: string) {
  const token = await ops.token(connectionId);
  const repo = await githubRepo(token, fullName);
  const id = await ops.saveRepository({
    connection_id: connectionId,
    github_repo_id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    full_name: repo.full_name,
    is_private: repo.private,
    default_branch: repo.default_branch,
    description: repo.description,
    homepage: repo.homepage,
    html_url: repo.html_url,
    clone_url: repo.clone_url,
    topics: repo.topics ?? [],
  });

  const hookUrl = env("WEBHOOK_PUBLIC_URL");
  if (hookUrl && !isDeployKey(token)) {
    try {
      const secret = randomSecret();
      const hookId = await githubCreateHook(token, repo.full_name, hookUrl, secret);
      await ops.storeWebhook(id, secret, hookId);
    } catch (error) {
      await ops.patchRepository(id, { sync_mode: "reconcile_only", sync_error: sanitize(githubMessage(error)) });
    }
  }

  await runSlice("manual", id);
  return { id, full_name: repo.full_name };
}

async function repositoryAccess(jwt: string, repositoryId: string) {
  const { data, error } = await userClient(jwt)
    .from("panel_repositories")
    .select("connection_id, full_name, default_branch")
    .eq("id", repositoryId)
    .maybeSingle();
  if (error || !data?.connection_id || !data.full_name) throw new Error("repositorio ausente");
  const token = await ops.token(String(data.connection_id));
  return { token, fullName: String(data.full_name), branch: String(data.default_branch || "HEAD") };
}

export async function repositoryMirror(jwt: string, repositoryId: string) {
  const access = await repositoryAccess(jwt, repositoryId);
  const repo = await githubRepo(access.token, access.fullName);
  const [languages, listing, readme, commits] = await Promise.all([
    githubLanguages(access.token, access.fullName),
    githubContents(access.token, access.fullName, "", repo.default_branch),
    githubReadmeHtml(access.token, access.fullName),
    githubCommitPage(access.token, access.fullName, repo.default_branch),
  ]);
  const total = languages.reduce((sum, item) => sum + item.bytes, 0);
  return {
    repo: {
      full_name: repo.full_name,
      description: repo.description,
      homepage: repo.homepage,
      html_url: repo.html_url,
      default_branch: repo.default_branch,
      private: repo.private,
      topics: repo.topics ?? [],
      language: repo.language ?? null,
      pushed_at: repo.pushed_at ?? null,
      updated_at: repo.updated_at ?? null,
    },
    languages: languages
      .map((item) => ({ ...item, percent: total ? Math.round((1000 * item.bytes) / total) / 10 : 0 }))
      .sort((a, b) => b.bytes - a.bytes),
    entries: listing.kind === "dir" ? listing.entries : [],
    readme_html: readme,
    commits,
  };
}

export async function repositoryContents(jwt: string, repositoryId: string, rawPath: string) {
  const access = await repositoryAccess(jwt, repositoryId);
  const repo = await githubRepo(access.token, access.fullName);
  return githubContents(access.token, access.fullName, safeRepoPath(rawPath), repo.default_branch);
}

export async function repositoryCommit(jwt: string, repositoryId: string, sha: string) {
  const access = await repositoryAccess(jwt, repositoryId);
  return githubCommitView(access.token, access.fullName, sha);
}

export async function storeConnection(label: string, token: string) {
  const login = isDeployKey(token) ? "chave-ssh" : await githubUser(token);
  const id = await ops.storeConnection(label, login, token);
  return { id, label, github_login: login };
}

export function webhookFiles(commit: { added?: string[]; removed?: string[]; modified?: string[] }) {
  const files = [
    ...(commit.added ?? []).map((filename) => ({ filename, status: "added" })),
    ...(commit.removed ?? []).map((filename) => ({ filename, status: "removed" })),
    ...(commit.modified ?? []).map((filename) => ({ filename, status: "modified" })),
  ];
  const mapped = mapFiles(files);
  return mapped;
}
