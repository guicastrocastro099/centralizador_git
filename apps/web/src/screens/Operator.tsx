import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

type Connection = { id: string; label: string; github_login: string };
type RepoHead = { id: string; full_name: string };
type Entry = { name: string; path: string; type: string; size: number | null; html_url: string };
type CommitRow = { sha: string; message: string; author_name: string | null; author_login: string | null; committed_at: string | null; html_url: string };
type Mirror = {
  repo: {
    full_name: string;
    description: string | null;
    homepage: string | null;
    html_url: string;
    default_branch: string;
    private: boolean;
    topics: string[];
    language: string | null;
    pushed_at: string | null;
    updated_at: string | null;
  };
  languages: { language: string; bytes: number; percent: number }[];
  entries: Entry[];
  readme_html: string | null;
  commits: CommitRow[];
};
type Listing =
  | { kind: "dir"; entries: Entry[] }
  | { kind: "file"; name: string; path: string; html_url: string; size: number; text: string | null };
type CommitDetail = CommitRow & { additions: number; deletions: number; files: { filename: string; status: string; additions: number; deletions: number }[] };

function when(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR");
}

export function Operator({ onSignOut }: { onSignOut: () => void }) {
  const [screen, setScreen] = useState<"repo" | "chaves">("repo");
  const [notice, setNotice] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [repos, setRepos] = useState<RepoHead[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    const [connectionRows, repoRows] = await Promise.all([
      supabase.from("panel_connections").select("id, label, github_login").order("created_at"),
      supabase.from("panel_repositories").select("id, full_name").order("updated_at", { ascending: false }),
    ]);
    const failed = [connectionRows, repoRows].find((row) => row.error);
    if (failed?.error) setNotice(`Erro: ${failed.error.message}`);
    setConnections(connectionRows.data ?? []);
    const nextRepos = repoRows.data ?? [];
    setRepos(nextRepos);
    setSelected((current) => current && nextRepos.some((repo) => repo.id === current) ? current : nextRepos[0]?.id ?? null);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <strong>Centralizador</strong>
          <span>O que o GitHub devolve para os repositórios ligados.</span>
        </div>
        <nav className="nav">
          {repos.length > 1 ? (
            <select value={selected ?? ""} onChange={(event) => { setSelected(event.target.value); setScreen("repo"); }}>
              {repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.full_name}</option>)}
            </select>
          ) : null}
          <button aria-current={screen === "repo" ? "page" : undefined} onClick={() => setScreen("repo")}>Repositório</button>
          <button aria-current={screen === "chaves" ? "page" : undefined} onClick={() => setScreen("chaves")}>Chaves</button>
          <button onClick={onSignOut}>Sair</button>
        </nav>
      </header>
      <main className="page">
        {notice ? <p className={notice.startsWith("Erro") ? "error" : "ok"}>{notice}</p> : null}
        {screen === "chaves" ? <Keys rows={connections} onChange={load} onNotice={setNotice} onOpen={(id) => { setSelected(id); setScreen("repo"); }} /> : null}
        {screen === "repo" && selected ? <Mirror key={selected} id={selected} /> : null}
        {screen === "repo" && !selected ? <p className="empty">Nenhum repositório. Em Chaves, cole um token e informe o endereço do GitHub.</p> : null}
      </main>
    </div>
  );
}

function Mirror({ id }: { id: string }) {
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"codigo" | "commits">("codigo");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [file, setFile] = useState<Extract<Listing, { kind: "file" }> | null>(null);
  const [commit, setCommit] = useState<CommitDetail | null>(null);

  useEffect(() => {
    let alive = true;
    api<Mirror>(`/repositories/${id}/mirror`).then((body) => {
      if (!alive) return;
      setMirror(body);
      setEntries(body.entries);
    }).catch((reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : "falha");
    });
    return () => { alive = false; };
  }, [id]);

  async function openEntry(entry: Entry) {
    const body = await api<Listing>(`/repositories/${id}/contents?path=${encodeURIComponent(entry.path)}`);
    if (body.kind === "dir") {
      setPath(entry.path);
      setEntries(body.entries);
      setFile(null);
      return;
    }
    setFile(body);
  }

  async function openDir(next: string) {
    if (!next) {
      if (!mirror) return;
      setPath("");
      setEntries(mirror.entries);
      setFile(null);
      return;
    }
    const body = await api<Listing>(`/repositories/${id}/contents?path=${encodeURIComponent(next)}`);
    if (body.kind === "dir") {
      setPath(next);
      setEntries(body.entries);
      setFile(null);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!mirror) return <p>Lendo o GitHub…</p>;
  const repo = mirror.repo;
  const crumbs = path ? path.split("/") : [];

  return (
    <section className="stack">
      <header className="repo-head">
        <div>
          <h1>{repo.full_name}</h1>
          <p>{repo.description || "Sem descrição no GitHub."}</p>
        </div>
        <span className="tag">{repo.private ? "Privado" : "Público"}</span>
      </header>
      <p className="muted">
        <a href={repo.html_url}>{repo.html_url}</a>
        {" · "}branch {repo.default_branch}
        {repo.pushed_at ? ` · push ${when(repo.pushed_at)}` : ""}
      </p>
      {repo.homepage ? <p><a href={repo.homepage}>{repo.homepage}</a></p> : null}
      {repo.topics.length ? <p className="tags">{repo.topics.map((topic) => <span className="tag" key={topic}>{topic}</span>)}</p> : null}
      {mirror.languages.length ? (
        <div className="bars">
          {mirror.languages.map((item) => (
            <div className="bar" key={item.language}><span>{item.language}</span><i style={{ width: `${item.percent}%` }} /><span>{item.percent}%</span></div>
          ))}
        </div>
      ) : null}
      <nav className="nav">
        <button aria-current={view === "codigo" ? "page" : undefined} onClick={() => setView("codigo")}>Código</button>
        <button aria-current={view === "commits" ? "page" : undefined} onClick={() => setView("commits")}>Commits ({mirror.commits.length})</button>
      </nav>
      {view === "codigo" ? (
        <div className="stack">
          <p className="crumbs">
            <button onClick={() => openDir("")}>{repo.full_name}</button>
            {crumbs.map((part, index) => {
              const next = crumbs.slice(0, index + 1).join("/");
              return <button key={next} onClick={() => openDir(next)}>{part}</button>;
            })}
          </p>
          <table className="files-table">
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.path}>
                  <td><button className={entry.type === "dir" ? "dir" : ""} onClick={() => openEntry(entry)}>{entry.type === "dir" ? `${entry.name}/` : entry.name}</button></td>
                  <td className="muted">{entry.type === "dir" || entry.size == null ? "" : `${entry.size} bytes`}</td>
                  <td><a href={entry.html_url}>GitHub</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {file ? (
            <article className="card stack">
              <header className="row"><strong>{file.path}</strong><a href={file.html_url}>Abrir no GitHub</a></header>
              {file.text != null ? <pre className="source">{file.text}</pre> : <p className="muted">Arquivo de {file.size} bytes. O GitHub não devolveu o texto.</p>}
            </article>
          ) : null}
          {!path && mirror.readme_html ? <article className="card readme" dangerouslySetInnerHTML={{ __html: mirror.readme_html }} /> : null}
        </div>
      ) : (
        <div className="stack">
          {mirror.commits.map((item) => (
            <article className="card stack" key={item.sha}>
              <header className="row">
                <strong>{item.message.split("\n")[0]}</strong>
                <a href={item.html_url}>{item.sha.slice(0, 7)}</a>
              </header>
              {item.message.includes("\n") ? <pre className="source">{item.message}</pre> : null}
              <p className="muted">{item.author_name}{item.author_login ? ` (@${item.author_login})` : ""} · {when(item.committed_at)}</p>
              <button className="ghost" onClick={async () => setCommit(commit?.sha === item.sha ? null : await api<CommitDetail>(`/repositories/${id}/github-commit/${item.sha}`))}>{commit?.sha === item.sha ? "Fechar arquivos" : "Arquivos deste commit"}</button>
              {commit?.sha === item.sha ? (
                <div className="stack">
                  <p className="muted">+{commit.additions} −{commit.deletions}</p>
                  <ul className="files">
                    {commit.files.map((changed) => <li key={changed.filename}>{changed.status} {changed.filename} +{changed.additions} −{changed.deletions}</li>)}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Keys({ rows, onChange, onNotice, onOpen }: { rows: Connection[]; onChange: () => Promise<void>; onNotice: (text: string) => void; onOpen: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [connectionId, setConnectionId] = useState(rows[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    if (!connectionId && rows[0]) setConnectionId(rows[0].id);
  }, [rows, connectionId]);

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/connections", { method: "POST", body: JSON.stringify({ label, token }) });
      setLabel("");
      setToken("");
      onNotice("O GitHub confirmou a chave. O token não volta para a tela.");
      await onChange();
    } catch (reason) {
      onNotice(`Erro: ${reason instanceof Error ? reason.message : "falha"}`);
    }
  }

  async function addRepo(event: FormEvent) {
    event.preventDefault();
    try {
      const name = fullName.trim().replace(/\.git$/, "").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      const created = await api<{ id: string }>("/repositories", { method: "POST", body: JSON.stringify({ connection_id: connectionId, full_name: name }) });
      setFullName("");
      onNotice("Repositório lido do GitHub.");
      await onChange();
      onOpen(created.id);
    } catch (reason) {
      onNotice(`Erro: ${reason instanceof Error ? reason.message : "falha"}`);
    }
  }

  return (
    <section className="grid">
      <form className="stack" onSubmit={saveKey}>
        <h2>Chave do GitHub</h2>
        <p className="muted">O token fica no Vault. A tela mostra o repositório que a API do GitHub devolver.</p>
        <label>Rótulo<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
        <label>Token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_… ou ghp_…" required /></label>
        <button className="primary" type="submit">Conferir no GitHub e guardar</button>
      </form>
      {rows.map((row) => (
        <article className="card" key={row.id}>
          <header><strong>{row.label}</strong><span className="muted">@{row.github_login}</span></header>
          <button className="ghost" onClick={async () => { await api(`/connections/${row.id}`, { method: "DELETE" }); await onChange(); }}>Remover</button>
        </article>
      ))}
      <form className="stack" onSubmit={addRepo}>
        <h2>Ligar repositório</h2>
        <label>Chave<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} required disabled={rows.length === 0}>{rows.map((item) => <option key={item.id} value={item.id}>{item.label} · @{item.github_login}</option>)}</select></label>
        <label>Repositório<input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="https://github.com/owner/nome" required disabled={rows.length === 0} /></label>
        <button className="primary" type="submit" disabled={rows.length === 0}>Ler do GitHub</button>
      </form>
    </section>
  );
}
