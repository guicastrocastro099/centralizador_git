import { isConfigured, ops, roleFor } from "./db.ts";
import { env } from "./env.ts";
import { bearer, corsHeaders, errorResponse, json, normalizePath, readJson } from "./http.ts";
import { verifyJwt } from "./jwt.ts";
import { GithubError, githubMessage } from "./github.ts";
import { connectRepository, runSlice, storeConnection } from "./sync.ts";

const USER_PATCH = new Set([
  "paused",
  "visibility",
  "showcase_title",
  "showcase_summary",
  "highlight",
  "highlight_public",
  "internal_note",
  "project_type",
  "code_kind",
  "history_limit",
]);

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function handleApi(req: Request): Promise<Response> {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const path = normalizePath(new URL(req.url).pathname, "api");
  const token = bearer(req);
  if (!token) return errorResponse(401, "jwt ausente", cors);
  const claims = await verifyJwt(token, env("JWT_SECRET") ?? "");
  if (!claims) return errorResponse(401, "jwt invalido", cors);
  if (!isConfigured()) return errorResponse(503, "indisponivel", cors);

  const role = await roleFor(token);
  if (!role) return errorResponse(403, "sem papel", cors);

  try {
    if (req.method === "GET" && path === "/me") return json({ role }, 200, cors);
    if (role !== "administrator") return errorResponse(403, "somente o administrador", cors);

    if (req.method === "POST" && path === "/connections") {
      const body = asObject(await readJson(req));
      const label = String(body.label ?? "");
      const githubToken = String(body.token ?? "");
      const created = await storeConnection(label, githubToken);
      return json(created, 201, cors);
    }

    const connectionMatch = path.match(/^\/connections\/([0-9a-f-]{36})$/);
    if (req.method === "DELETE" && connectionMatch) {
      await ops.deleteConnection(connectionMatch[1]);
      return json({ ok: true }, 200, cors);
    }

    if (req.method === "POST" && path === "/repositories") {
      const body = asObject(await readJson(req));
      const created = await connectRepository(String(body.connection_id ?? ""), String(body.full_name ?? ""));
      return json(created, 201, cors);
    }

    const repoMatch = path.match(/^\/repositories\/([0-9a-f-]{36})$/);
    if (req.method === "PATCH" && repoMatch) {
      const body = asObject(await readJson(req));
      const patch: Record<string, unknown> = {};
      for (const key of USER_PATCH) {
        if (key in body) patch[key] = body[key];
      }
      await ops.patchRepository(repoMatch[1], patch);
      return json({ ok: true }, 200, cors);
    }

    const syncMatch = path.match(/^\/repositories\/([0-9a-f-]{36})\/sync$/);
    if (req.method === "POST" && syncMatch) {
      const outcome = await runSlice("manual", syncMatch[1]);
      return json(outcome, 200, cors);
    }

    if (req.method === "POST" && path === "/features") {
      const body = asObject(await readJson(req));
      const id = await ops.saveFeature(body);
      return json({ id }, 201, cors);
    }

    const featureMatch = path.match(/^\/features\/([0-9a-f-]{36})$/);
    if (req.method === "PATCH" && featureMatch) {
      const body = asObject(await readJson(req));
      const id = await ops.saveFeature({ ...body, id: featureMatch[1] });
      return json({ id }, 200, cors);
    }
    if (req.method === "DELETE" && featureMatch) {
      await ops.deleteFeature(featureMatch[1]);
      return json({ ok: true }, 200, cors);
    }

    const commitMatch = path.match(/^\/commits\/([0-9a-f-]{36})$/);
    if (req.method === "PATCH" && commitMatch) {
      const body = asObject(await readJson(req));
      await ops.setShowcaseMessage(commitMatch[1], String(body.showcase_message ?? ""));
      return json({ ok: true }, 200, cors);
    }

    return errorResponse(404, "nao encontrado", cors);
  } catch (error) {
    const status = error instanceof GithubError ? (error.status === 404 ? 404 : 502) : 400;
    return errorResponse(status, githubMessage(error), cors);
  }
}
