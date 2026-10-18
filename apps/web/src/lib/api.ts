import { supabase } from "./supabase";

const base = import.meta.env.VITE_API_URL || "http://localhost:8787";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  const response = await fetch(`${base}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "pedido recusado";
    throw new Error(message);
  }
  return body as T;
}
