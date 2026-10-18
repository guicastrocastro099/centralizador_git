import { sanitize } from "./http.ts";

const API = "https://api.github.com";

export class GithubError extends Error {
  constructor(readonly status: number) {
    super(`GitHub respondeu ${status}`);
  }
}

export function isDeployKey(token: string): boolean {
  return token.includes("OPENSSH PRIVATE KEY");
}

export function githubRequestHeaders(token: string, init: RequestInit = {}): Headers {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/vnd.github+json");
  headers.set("x-github-api-version", "2022-11-28");
  headers.set("user-agent", "centralizador-repositorios");
  if (init.body) headers.set("content-type", "application/json");
  if (isDeployKey(token)) headers.delete("authorization");
  else headers.set("authorization", `Bearer ${token}`);
  return headers;
}

export async function github(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: githubRequestHeaders(token, init),
  });
  if (!response.ok) {
    await response.text();
    throw new GithubError(response.status);
  }
  return response;
}

export async function githubUser(token: string): Promise<string> {
  const response = await github(token, "/user");
  const body = await response.json() as { login?: string };
  if (!body.login) throw new Error("GitHub nao devolveu o login");
  return body.login;
}

export type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  homepage: string | null;
  html_url: string;
  clone_url: string;
  owner: { login: string };
  topics?: string[];
  language?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
};

export async function githubRepo(token: string, fullName: string): Promise<GithubRepo> {
  const response = await github(token, `/repos/${fullName}`);
  return await response.json() as GithubRepo;
}

export type ListedCommit = {
  sha: string;
  commit: { message: string; author: { name?: string; date?: string } | null };
  author: { login?: string } | null;
};

export async function githubCommits(token: string, fullName: string, page: number, since: string): Promise<ListedCommit[]> {
  const params = new URLSearchParams({
    per_page: "20",
    page: String(page),
    since,
  });
  const response = await github(token, `/repos/${fullName}/commits?${params}`);
  return await response.json() as ListedCommit[];
}

export type GithubFile = { filename: string; status: string; additions: number; deletions: number };

export async function githubCommit(token: string, fullName: string, sha: string): Promise<{
  additions: number;
  deletions: number;
  files: GithubFile[];
}> {
  const response = await github(token, `/repos/${fullName}/commits/${sha}`);
  const body = await response.json() as { stats?: { additions?: number; deletions?: number }; files?: GithubFile[] };
  return {
    additions: body.stats?.additions ?? 0,
    deletions: body.stats?.deletions ?? 0,
    files: body.files ?? [],
  };
}

export async function githubLanguages(token: string, fullName: string): Promise<{ language: string; bytes: number }[]> {
  const response = await github(token, `/repos/${fullName}/languages`);
  const body = await response.json() as Record<string, number>;
  return Object.entries(body).map(([language, bytes]) => ({ language, bytes }));
}

export async function githubCreateHook(token: string, fullName: string, url: string, secret: string): Promise<number> {
  const response = await github(token, `/repos/${fullName}/hooks`, {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push"],
      config: { url, content_type: "json", secret, insecure_ssl: "0" },
    }),
  });
  const body = await response.json() as { id?: number };
  if (!body.id) throw new Error("GitHub nao devolveu o webhook");
  return body.id;
}

export function safeRepoPath(value: string): string {
  const path = value.replace(/^\/+|\/+$/g, "");
  if (!path) return "";
  if (path.length > 500 || path.split("/").some((part) => part === "" || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("caminho invalido");
  }
  return path;
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\s(on\w+|style)=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "href=\"#\"")
    .slice(0, 200_000);
}

export type GithubEntry = {
  name: string;
  path: string;
  type: string;
  size: number | null;
  html_url: string;
};

export async function githubContents(token: string, fullName: string, path: string, ref: string): Promise<
  | { kind: "dir"; entries: GithubEntry[] }
  | { kind: "file"; name: string; path: string; html_url: string; size: number; text: string | null }
> {
  const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  const response = await github(token, `/repos/${fullName}/contents${suffix}?ref=${encodeURIComponent(ref)}`);
  const body = await response.json() as GithubEntry[] | { name: string; path: string; html_url: string; size?: number; encoding?: string; content?: string };
  if (Array.isArray(body)) {
    const entries = body.map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      size: item.size,
      html_url: item.html_url,
    })).sort((a, b) => Number(a.type !== "dir") - Number(b.type !== "dir") || a.name.localeCompare(b.name));
    return { kind: "dir", entries };
  }
  let text: string | null = null;
  if (body.encoding === "base64" && body.content && (body.size ?? 0) <= 100_000) {
    const bytes = Uint8Array.from(atob(body.content.replace(/\n/g, "")), (char) => char.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
  }
  return { kind: "file", name: body.name, path: body.path, html_url: body.html_url, size: body.size ?? 0, text };
}

export async function githubReadmeHtml(token: string, fullName: string): Promise<string | null> {
  const headers = githubRequestHeaders(token);
  headers.set("accept", "application/vnd.github.html");
  const response = await fetch(`${API}/repos/${fullName}/readme`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    await response.text();
    throw new GithubError(response.status);
  }
  return sanitizeHtml(await response.text());
}

export async function githubCommitPage(token: string, fullName: string, branch: string) {
  const response = await github(token, `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=100`);
  const body = await response.json() as ListedCommit[];
  return body.map((item) => ({
    sha: item.sha,
    message: item.commit.message,
    author_name: item.commit.author?.name ?? null,
    author_login: item.author?.login ?? null,
    committed_at: item.commit.author?.date ?? null,
    html_url: `https://github.com/${fullName}/commit/${item.sha}`,
  }));
}

export async function githubCommitView(token: string, fullName: string, sha: string) {
  const response = await github(token, `/repos/${fullName}/commits/${sha}`);
  const body = await response.json() as {
    sha?: string;
    html_url?: string;
    commit?: { message?: string; author?: { name?: string; date?: string } | null };
    author?: { login?: string } | null;
    stats?: { additions?: number; deletions?: number };
    files?: GithubFile[];
  };
  return {
    sha: body.sha ?? sha,
    message: body.commit?.message ?? "",
    author_name: body.commit?.author?.name ?? null,
    author_login: body.author?.login ?? null,
    committed_at: body.commit?.author?.date ?? null,
    additions: body.stats?.additions ?? 0,
    deletions: body.stats?.deletions ?? 0,
    html_url: body.html_url ?? `https://github.com/${fullName}/commit/${sha}`,
    files: (body.files ?? []).map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    })),
  };
}

export function githubMessage(error: unknown): string {
  if (error instanceof GithubError) {
    if (error.status === 401 || error.status === 403) return "GitHub recusou a chave ou o limite de pedidos";
    if (error.status === 404) return "repositorio nao encontrado para essa chave";
    return sanitize(error.message);
  }
  if (error instanceof Error) return sanitize(error.message);
  return "falha no GitHub";
}
