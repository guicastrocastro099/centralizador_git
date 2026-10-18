import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.ts";
import { sanitize } from "./http.ts";

export type RepoSlice = {
  id: string;
  connection_id: string;
  github_repo_id: number;
  full_name: string;
  default_branch: string;
  backfill_page: number;
  incremental_page: number;
  backfill_done: boolean;
  history_limit: number;
  history_since: string;
  last_synced_sha: string | null;
  pending_tip_sha: string | null;
};

export type AcquireResult =
  | { already_running: true }
  | { empty: true }
  | { run_id: string; commit_count: number; repository: RepoSlice };

export type WakeStatus = { pending: boolean; error: boolean; repos_remaining: number };

function configured(): boolean {
  return Boolean(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY") && env("SUPABASE_ANON_KEY"));
}

export function isConfigured(): boolean {
  return configured();
}

function service(): SupabaseClient {
  return createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(jwt: string): SupabaseClient {
  return createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service().rpc(name, args);
  if (error) throw new Error(sanitize(error.message));
  return data as T;
}

export async function roleFor(jwt: string): Promise<"administrator" | "viewer" | null> {
  const { data, error } = await userClient(jwt).from("my_profile").select("app_role").maybeSingle();
  if (error || !data) return null;
  if (data.app_role === "administrator" || data.app_role === "viewer") return data.app_role;
  return null;
}

export const ops = {
  storeConnection: (label: string, login: string, token: string) =>
    call<string>("op_store_connection", { p_label: label, p_login: login, p_token: token }),
  deleteConnection: (id: string) => call<void>("op_delete_connection", { p_id: id }),
  token: (connectionId: string) => call<string>("op_token", { p_connection_id: connectionId }),
  webhookSecret: (repositoryId: string) => call<string>("op_webhook_secret", { p_repository_id: repositoryId }),
  storeWebhook: (repositoryId: string, secret: string, hookId: number) =>
    call<void>("op_store_webhook", { p_repository_id: repositoryId, p_secret: secret, p_hook_id: hookId }),
  saveRepository: (payload: Record<string, unknown>) => call<string>("op_save_repository", { p: payload }),
  patchRepository: (id: string, payload: Record<string, unknown>) =>
    call<void>("op_patch_repository", { p_id: id, p: payload }),
  saveLanguages: (repositoryId: string, languages: { language: string; bytes: number }[]) =>
    call<void>("op_save_languages", { p_repository_id: repositoryId, p: languages }),
  saveCommits: (repositoryId: string, commits: unknown[]) =>
    call<number>("op_save_commits", { p_repository_id: repositoryId, p: commits }),
  saveFeature: (payload: Record<string, unknown>) => call<string>("op_save_feature", { p: payload }),
  deleteFeature: (id: string) => call<void>("op_delete_feature", { p_id: id }),
  setShowcaseMessage: (id: string, message: string) =>
    call<void>("op_set_showcase_message", { p_id: id, p_message: message }),
  acquireSlice: (trigger: "reconcile" | "manual", repositoryId: string | null) =>
    call<AcquireResult>("op_acquire_slice", { p_trigger: trigger, p_repository_id: repositoryId }),
  finishSlice: (runId: string, status: "ok" | "error", pending: boolean, remaining: number, added: number, error: string | null) =>
    call<void>("op_finish_slice", {
      p_run_id: runId,
      p_status: status,
      p_pending: pending,
      p_repos_remaining: remaining,
      p_commits_added: added,
      p_error: error,
    }),
  remaining: () => call<number>("op_repos_remaining", {}),
  wakeStatus: () => call<WakeStatus>("op_wake_status", {}),
  repositoryByGithub: (githubRepoId: number) =>
    call<Record<string, unknown> | null>("op_repository_by_github", { p_github_repo_id: githubRepoId }),
  recordWebhookRun: (repositoryId: string, added: number, error: string | null) =>
    call<void>("op_record_webhook_run", { p_repository_id: repositoryId, p_added: added, p_error: error }),
};
