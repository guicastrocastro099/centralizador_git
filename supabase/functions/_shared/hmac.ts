export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function signHmacSha256(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, body as BufferSource));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyGithubSignature(secret: string, body: Uint8Array, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = (await signHmacSha256(secret, body)).toLowerCase();
  const actual = header.slice("sha256=".length).trim().toLowerCase();
  return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(actual));
}
