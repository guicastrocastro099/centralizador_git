import { isConfigured, ops } from "./db.ts";
import { verifyGithubSignature } from "./hmac.ts";
import { json, normalizePath, sanitize } from "./http.ts";
import { webhookFiles } from "./sync.ts";

type PushCommit = {
  id: string;
  message: string;
  timestamp: string;
  author?: { name?: string; username?: string };
  added?: string[];
  removed?: string[];
  modified?: string[];
};

type PushPayload = {
  ref?: string;
  after?: string;
  repository?: { id?: number };
  commits?: PushCommit[];
};

export async function handleWebhook(req: Request): Promise<Response> {
  const path = normalizePath(new URL(req.url).pathname, "github-webhook");
  if (req.method !== "POST" || path !== "/webhooks/github") return json({ error: "nao encontrado" }, 404);
  if (!isConfigured()) return new Response(null, { status: 503 });

  const raw = new Uint8Array(await req.arrayBuffer());
  let payload: PushPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as PushPayload;
  } catch {
    return new Response(null, { status: 400 });
  }

  const githubId = payload.repository?.id;
  if (!githubId) return new Response(null, { status: 401 });
  const repo = await ops.repositoryByGithub(githubId);
  if (!repo?.id) return new Response(null, { status: 401 });

  const event = req.headers.get("x-github-event");
  let secret: string;
  try {
    secret = await ops.webhookSecret(String(repo.id));
  } catch {
    return new Response(null, { status: 401 });
  }
  const valid = await verifyGithubSignature(secret, raw, req.headers.get("x-hub-signature-256"));
  if (!valid) return new Response(null, { status: 401 });

  if (event === "ping") return json({ ok: true });
  if (event !== "push") return json({ ok: true });

  const commits = (payload.commits ?? []).map((commit) => {
    const files = webhookFiles(commit);
    return {
      sha: commit.id,
      message: commit.message,
      author_name: commit.author?.name ?? null,
      author_login: commit.author?.username ?? null,
      committed_at: commit.timestamp,
      additions: null,
      deletions: null,
      files_changed: files.files_changed,
      files_truncated: files.files_truncated,
      files: files.files,
    };
  });

  try {
    const added = commits.length ? await ops.saveCommits(String(repo.id), commits) : 0;
    const ref = payload.ref ?? "";
    const onDefault = ref.endsWith(`/${String(repo.default_branch)}`);
    if (onDefault && payload.after) {
      await ops.patchRepository(String(repo.id), { last_synced_sha: payload.after, sync_status: "idle", sync_error: null });
    }
    await ops.recordWebhookRun(String(repo.id), added, null);
    return json({ ok: true });
  } catch (error) {
    const message = sanitize(error instanceof Error ? error.message : "falha no webhook");
    await ops.recordWebhookRun(String(repo.id), 0, message);
    return json({ error: "falha ao gravar" }, 500);
  }
}
