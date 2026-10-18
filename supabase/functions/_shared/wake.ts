import { isConfigured, ops } from "./db.ts";
import { json, normalizePath } from "./http.ts";
import { runSlice } from "./sync.ts";

export async function handleWake(req: Request): Promise<Response> {
  const path = normalizePath(new URL(req.url).pathname, "wake");
  if (req.method === "GET" && path === "/health") return json({ status: "ok" });

  if (!isConfigured()) return json({ error: "indisponivel" }, 503);

  if (req.method === "GET" && path === "/internal/status") {
    const status = await ops.wakeStatus();
    return json({
      pending: Boolean(status.pending),
      error: Boolean(status.error),
      repos_remaining: Number(status.repos_remaining ?? 0),
    });
  }

  if (req.method === "POST" && path === "/internal/reconcile") {
    const outcome = await runSlice("reconcile", null);
    if ("already_running" in outcome) return json({ already_running: true });
    return json({ pending: outcome.pending });
  }

  return json({ error: "nao encontrado" }, 404);
}
