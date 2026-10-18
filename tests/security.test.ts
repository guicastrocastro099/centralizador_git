import { describe, expect, test } from "bun:test";
import { setEnvReader } from "../supabase/functions/_shared/env.ts";
import { verifyGithubSignature } from "../supabase/functions/_shared/hmac.ts";
import { sanitize } from "../supabase/functions/_shared/http.ts";
import { signJwt, verifyJwt } from "../supabase/functions/_shared/jwt.ts";
import { handleApi } from "../supabase/functions/_shared/api.ts";
import { handleWake } from "../supabase/functions/_shared/wake.ts";
import { handleWebhook } from "../supabase/functions/_shared/webhook.ts";
import { githubRequestHeaders } from "../supabase/functions/_shared/github.ts";

setEnvReader((key) => {
  if (key === "JWT_SECRET") return "segredo-de-teste";
  if (key === "CORS_ORIGIN") return "http://localhost:5173";
  return undefined;
});

describe("segredos e acesso", () => {
  test("chave ssh nao segue para a API do GitHub", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3\n-----END OPENSSH PRIVATE KEY-----";
    const headers = githubRequestHeaders(key);
    expect(headers.get("authorization")).toBeNull();
    expect([...headers.values()].join(" ")).not.toContain("OPENSSH");
  });

  test("tira token e assinatura de mensagens", () => {
    const text = sanitize("falhou github_pat_abc123 e ghp_zzz com Bearer ghp_outro sha256=abcd");
    expect(text).not.toContain("github_pat_");
    expect(text).not.toContain("ghp_");
    expect(text).toContain("[segredo]");
    expect(text).toContain("[assinatura]");
  });

  test("aceita só o HMAC certo", async () => {
    const body = new TextEncoder().encode("{\"zen\":1}");
    const { signHmacSha256 } = await import("../supabase/functions/_shared/hmac.ts");
    const digest = await signHmacSha256("hook", body);
    expect(await verifyGithubSignature("hook", body, `sha256=${digest}`)).toBe(true);
    expect(await verifyGithubSignature("hook", body, "sha256=00")).toBe(false);
    expect(await verifyGithubSignature("hook", body, null)).toBe(false);
  });

  test("rejeita JWT expirado, audiência errada e assinatura trocada", async () => {
    const secret = "segredo-de-teste";
    const good = await signJwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60, aud: "authenticated" }, secret);
    expect((await verifyJwt(good, secret))?.sub).toBe("user-1");
    const expired = await signJwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) - 10, aud: "authenticated" }, secret);
    expect(await verifyJwt(expired, secret)).toBeNull();
    const wrongAud = await signJwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60, aud: "outro" }, secret);
    expect(await verifyJwt(wrongAud, secret)).toBeNull();
    expect(await verifyJwt(good.slice(0, -2) + "aa", secret)).toBeNull();
  });

  test("a api recusa chamada sem JWT", async () => {
    const response = await handleApi(new Request("http://localhost/api/me"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("jwt ausente");
  });

  test("a api recusa JWT inválido", async () => {
    const response = await handleApi(new Request("http://localhost/api/connections", {
      method: "POST",
      headers: { authorization: "Bearer nao.e.jwt" },
    }));
    expect(response.status).toBe(401);
  });

  test("o wake responde só o estado, sem dados de repositório", async () => {
    const health = await handleWake(new Request("http://localhost/wake/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const status = await handleWake(new Request("http://localhost/wake/internal/status"));
    expect(status.status).toBe(503);
    const body = await status.json();
    expect(body).toEqual({ error: "indisponivel" });
    expect(JSON.stringify(body)).not.toMatch(/github|owner|token/i);
  });

  test("webhook sem assinatura não grava e não devolve corpo útil", async () => {
    const response = await handleWebhook(new Request("http://localhost/webhooks/github", {
      method: "POST",
      body: JSON.stringify({ repository: { id: 1 }, commits: [] }),
    }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
