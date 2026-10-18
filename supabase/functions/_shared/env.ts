type EnvReader = (key: string) => string | undefined;

let reader: EnvReader = (key) => {
  const deno = (globalThis as { Deno?: { env: { get: (name: string) => string | undefined } } }).Deno;
  if (deno?.env) return deno.env.get(key);
  return undefined;
};

export function setEnvReader(next: EnvReader) {
  reader = next;
}

export function env(key: string): string | undefined {
  const value = reader(key);
  if (value == null || value.trim() === "") return undefined;
  return value;
}

export function requireEnv(key: string): string {
  const value = env(key);
  if (!value) throw new Error(`ambiente incompleto: ${key}`);
  return value;
}
