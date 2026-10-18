import { setEnvReader } from "../supabase/functions/_shared/env.ts";
import { handleApi } from "../supabase/functions/_shared/api.ts";
import { handleWake } from "../supabase/functions/_shared/wake.ts";
import { handleWebhook } from "../supabase/functions/_shared/webhook.ts";
import { json } from "../supabase/functions/_shared/http.ts";

setEnvReader((key) => process.env[key]);

const port = Number(process.env.PORT ?? 8787);

function rewrite(req: Request, pathname: string): Request {
  const url = new URL(req.url);
  url.pathname = pathname;
  return new Request(url, req);
}

Bun.serve({
  port,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/wake")) return handleWake(rewrite(req, path.slice("/wake".length) || "/"));
    if (path.startsWith("/webhooks")) return handleWebhook(req);
    if (path.startsWith("/api")) return handleApi(rewrite(req, path.slice("/api".length) || "/"));
    return json({ error: "nao encontrado" }, 404);
  },
});

console.log(`api local em http://localhost:${port}`);
