import { env } from "./env.ts";
import { timingSafeEqual } from "./hmac.ts";

export type JwtClaims = {
  sub: string;
  exp: number;
  aud: string | string[];
  role?: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function signJwt(claims: JwtClaims, secret: string): Promise<string> {
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return `${header}.${payload}.${bytesToBase64Url(sig)}`;
}

type PublicJwk = JsonWebKey & { kid?: string };

let jwksCache: { keys: PublicJwk[]; at: number } | null = null;

async function projectJwks(): Promise<PublicJwk[]> {
  const base = env("SUPABASE_URL");
  if (!base) return [];
  if (jwksCache && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const response = await fetch(`${base.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`);
  if (!response.ok) return [];
  const body = await response.json() as { keys?: PublicJwk[] };
  jwksCache = { keys: body.keys ?? [], at: Date.now() };
  return jwksCache.keys;
}

async function verifyEs256(headerPart: string, payloadPart: string, signaturePart: string, kid?: string): Promise<boolean> {
  const keys = await projectJwks();
  const match = keys.find((key) => key.kty === "EC" && key.crv === "P-256" && (!kid || key.kid === kid));
  if (!match?.x || !match.y) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: match.x, y: match.y, alg: "ES256", ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
}

export async function verifyJwt(token: string, secret: string): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerPart)));
  } catch {
    return null;
  }
  if (header.alg === "ES256") {
    if (!await verifyEs256(headerPart, payloadPart, signaturePart, header.kid)) return null;
  } else if (header.alg === "HS256") {
    if (!secret) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${headerPart}.${payloadPart}`)),
    );
    const actual = base64UrlToBytes(signaturePart);
    if (!timingSafeEqual(expected, actual)) return null;
  } else {
    return null;
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
  } catch {
    return null;
  }
  if (!claims.sub || typeof claims.exp !== "number") return null;
  if (claims.exp * 1000 <= Date.now()) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes("authenticated")) return null;
  return claims;
}
