import { env } from "./env.ts";

const TOKEN_PATTERN = /github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|gho_[A-Za-z0-9_]+|ghu_[A-Za-z0-9_]+|ghs_[A-Za-z0-9_]+|ghr_[A-Za-z0-9_]+/g;

export function sanitize(text: string): string {
  return text
    .replace(/-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g, "[segredo]")
    .replace(TOKEN_PATTERN, "[segredo]")
    .replace(/Bearer\s+\S+/gi, "Bearer [segredo]")
    .replace(/sha256=[0-9a-f]+/gi, "sha256=[assinatura]");
}

export function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...Object.fromEntries(new Headers(extra)),
    },
  });
}

export function errorResponse(status: number, error: string, extra: HeadersInit = {}): Response {
  return json({ error: sanitize(error) }, status, extra);
}

export function normalizePath(pathname: string, functionName: string): string {
  const markers = [`/functions/v1/${functionName}`, `/${functionName}`];
  for (const marker of markers) {
    const at = pathname.indexOf(marker);
    if (at >= 0) {
      const rest = pathname.slice(at + marker.length);
      if (rest === "") return "/";
      return rest.startsWith("/") ? rest : `/${rest}`;
    }
  }
  return pathname || "/";
}

export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const allowed = (envOriginList());
  const ok = origin != null && allowed.includes(origin);
  if (!ok) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "vary": "Origin",
  };
}

function envOriginList(): string[] {
  const raw = env("CORS_ORIGIN") ?? "";
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (list.length === 0) return ["http://localhost:5173"];
  return list;
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  return JSON.parse(text);
}
