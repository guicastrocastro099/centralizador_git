import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { CODE_KINDS, PROJECT_TYPES, label } from "../labels";
import { supabase } from "../lib/supabase";

type Tab = "tempo" | "repos" | "chaves";
type Connection = { id: string; label: string; github_login: string; paused: boolean };
type Repo = {
  id: string;
  connection_id: string;
  full_name: string;
  html_url: string | null;
  visibility: "interno" | "vitrine";
  showcase_title: string | null;
  showcase_summary: string | null;
  highlight: string | null;
  highlight_public: boolean;
  internal_note: string | null;
  project_type: string | null;
  code_kind: string | null;
  sync_mode: string;
  sync_status: string;
  sync_error: string | null;
  paused: boolean;
  backfill_done: boolean;
  history_limit: number;
  last_remote_check_at: string | null;
  feature_count: number;
  is_private: boolean;
  updated_at?: string;
};
type Commit = {
  id: string;
  repository_id: string;
  sha: string;
  message: string;
  showcase_message: string | null;
  author_name: string | null;
  committed_at: string;
  additions: number | null;
  deletions: number | null;
  files_changed: number | null;
  full_name: string;
  project_type: string | null;
  code_kind: string | null;
  visibility: string;
  paused: boolean;
};
type FileRow = { id: string; commit_id: string; filename: string; status: string; additions: number | null; deletions: number | null };
type Language = { repository_id: string; language: string; bytes: number; percent: number };
type Feature = { id: string; repository_id: string; name: string; description: string | null; show_in_showcase: boolean; position: number };
type Run = { id: string; status: string; trigger: string; error: string | null; started_at: string; commits_added: number | null };

export function Operator({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("chaves");
  const [notice, setNotice] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [codeKind, setCodeKind] = useState("");
  const [projectType, setProjectType] = useState("");
  const [language, setLanguage] = useState("");
  const [visibility, setVisibility] = useState("");
  const [paused, setPaused] = useState("");

  async function load() {
    const [connectionRows, repoRows, commitRows, languageRows] = await Promise.all([
      supabase.from("panel_connections").select("*").order("created_at"),
      supabase.from("panel_repositories").select("*").order("updated_at", { ascending: false }),
      supabase.from("panel_commits").select("*").order("committed_at", { ascending: false }).limit(100),
      supabase.from("panel_languages").select("*"),
    ]);
    const failed = [connectionRows, repoRows, commitRows, languageRows].find((row) => row.error);
    if (failed?.error) setNotice(`Erro: ${failed.error.message}`);
    setConnections(connectionRows.data ?? []);
    setRepos(repoRows.data ?? []);
    setCommits(commitRows.data ?? []);
    setLanguages(languageRows.data ?? []);
  }

  useEffect(() => { load(); }, []);

  const languageIds = new Set(languages.filter((item) => item.language === language).map((item) => item.repository_id));
  const repoPass = (repo: { id: string; repository_id?: string; code_kind: string | null; project_type: string | null; visibility: string; paused: boolean }) => {
    const id = repo.repository_id ?? repo.id;
    if (codeKind && repo.code_kind !== codeKind) return false;
    if (projectType && repo.project_type !== projectType) return false;
    if (visibility && repo.visibility !== visibility) return false;
    if (paused === "sim" && !repo.paused) return false;
    if (paused === "nao" && repo.paused) return false;
    if (language && !languageIds.has(id)) return false;
    return true;
  };

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <strong>Centralizador</strong>
          <span>Commits só entram depois que uma chave lê o GitHub.</span>
        </div>
        <nav className="nav">
          <button aria-current={tab === "chaves" ? "page" : undefined} onClick={() => { setTab("chaves"); setSelected(null); }}>Chaves</button>
          <button aria-current={tab === "repos" ? "page" : undefined} onClick={() => { setTab("repos"); setSelected(null); }}>Repositórios</button>
          <button aria-current={tab === "tempo" ? "page" : undefined} onClick={() => { setTab("tempo"); setSelected(null); }}>Linha do tempo</button>
          <button onClick={onSignOut}>Sair</button>
        </nav>
      </header>
      <main className="page">
        {notice ? <p className={notice.startsWith("Erro") ? "error" : "ok"}>{notice}</p> : null}
        {repos.length > 0 && tab !== "chaves" && !selected ? <Filters language={language} languages={languages} codeKind={codeKind} projectType={projectType} visibility={visibility} paused={paused} onLanguage={setLanguage} onCode={setCodeKind} onProject={setProjectType} onVisibility={setVisibility} onPaused={setPaused} /> : null}
        {tab === "tempo" && !selected ? <Timeline commits={commits.filter(repoPass)} onOpen={(id) => { setSelected(id); setTab("repos"); }} /> : null}
        {tab === "chaves" ? <Connections rows={connections} onChange={load} onNotice={setNotice} /> : null}
        {tab === "repos" && !selected ? <RepoList rows={repos.filter((repo) => repoPass(repo))} connections={connections} onOpen={setSelected} onChange={load} onNotice={setNotice} /> : null}
        {selected ? <Detail id={selected} onBack={() => setSelected(null)} onChange={load} onNotice={setNotice} /> : null}
      </main>
    </div>
  );
}

function Filters(props: {
  language: string; languages: Language[]; codeKind: string; projectType: string; visibility: string; paused: string;
  onLanguage: (value: string) => void; onCode: (value: string) => void; onProject: (value: string) => void; onVisibility: (value: string) => void; onPaused: (value: string) => void;
}) {
  const names = [...new Set(props.languages.map((item) => item.language))];
  return (
    <div className="filters">
      <select value={props.language} onChange={(event) => props.onLanguage(event.target.value)}><option value="">Linguagem</option>{names.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={props.codeKind} onChange={(event) => props.onCode(event.target.value)}><option value="">Tipo de código</option>{CODE_KINDS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
      <select value={props.projectType} onChange={(event) => props.onProject(event.target.value)}><option value="">Tipo de projeto</option>{PROJECT_TYPES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
      <select value={props.visibility} onChange={(event) => props.onVisibility(event.target.value)}><option value="">Visibilidade</option><option value="interno">Interno</option><option value="vitrine">Vitrine</option></select>
      <select value={props.paused} onChange={(event) => props.onPaused(event.target.value)}><option value="">Pausa</option><option value="sim">Pausados</option><option value="nao">Ativos</option></select>
    </div>
  );
}

function Timeline({ commits, onOpen }: { commits: Commit[]; onOpen: (id: string) => void }) {
  if (commits.length === 0) return <p className="empty">Nenhum commit lido do GitHub. Cole uma chave e acompanhe um repositório.</p>;
  return (
    <section className="timeline">
      {commits.map((commit) => (
        <article className="event" key={commit.id}>
          <time>{new Date(commit.committed_at).toLocaleString("pt-BR")}</time>
          <div>
            <strong>{commit.full_name}</strong>
            <p>{commit.message.split("\n")[0]}</p>
            <p className="muted">{commit.author_name} · +{commit.additions ?? "?"} −{commit.deletions ?? "?"} · {commit.files_changed ?? "?"} arquivos</p>
            <a href={`https://github.com/${commit.full_name}/commit/${commit.sha}`}>{commit.sha.slice(0, 8)} no GitHub</a>
            <button className="ghost" onClick={() => onOpen(commit.repository_id)}>Abrir ficha</button>
          </div>
        </article>
      ))}
    </section>
  );
}

function Connections({ rows, onChange, onNotice }: { rows: Connection[]; onChange: () => Promise<void>; onNotice: (text: string) => void }) {
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/connections", { method: "POST", body: JSON.stringify({ label, token }) });
      setToken("");
      setLabel("");
      onNotice("Conexão gravada. A chave não volta para a tela.");
      await onChange();
    } catch (error) {
      onNotice(`Erro: ${error instanceof Error ? error.message : "falha"}`);
    }
  }

  return (
    <section className="grid">
      <form className="stack" onSubmit={submit}>
        <h2>Chave do GitHub</h2>
        <p className="muted">Cada conta usa a própria chave. O painel guarda o token no Vault e mostra só o login que o GitHub devolveu. Sem chave, nada é lido.</p>
        <label>Rótulo<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
        <label>Token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_… ou ghp_…" required /></label>
        <button className="primary" type="submit">Conferir no GitHub e guardar</button>
      </form>
      {rows.length === 0 ? <p className="empty">Nenhuma chave. O que aparecer daqui em diante vem da API do GitHub com o token que você colar.</p> : null}
      {rows.map((row) => (
        <article className="card" key={row.id}>
          <header><strong>{row.label}</strong><span className="muted">GitHub confirmou @{row.github_login}</span></header>
          <button className="ghost" onClick={async () => { await api(`/connections/${row.id}`, { method: "DELETE" }); await onChange(); }}>Remover</button>
        </article>
      ))}
    </section>
  );
}

function RepoList({ rows, connections, onOpen, onChange, onNotice }: { rows: Repo[]; connections: Connection[]; onOpen: (id: string) => void; onChange: () => Promise<void>; onNotice: (text: string) => void }) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    if (!connectionId && connections[0]) setConnectionId(connections[0].id);
  }, [connections, connectionId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const name = fullName.trim().replace(/\.git$/, "").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
      await api("/repositories", { method: "POST", body: JSON.stringify({ connection_id: connectionId, full_name: name }) });
      setFullName("");
      onNotice("O GitHub devolveu o repositório. A primeira leitura dos commits foi pedida.");
      await onChange();
    } catch (error) {
      onNotice(`Erro: ${error instanceof Error ? error.message : "falha"}`);
    }
  }

  return (
    <section className="grid">
      <form className="stack" onSubmit={submit}>
        <h2>Incluir repositório</h2>
        {connections.length === 0 ? <p className="empty">Primeiro guarde uma chave. Sem ela este formulário não chama o GitHub.</p> : null}
        <label>Chave<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} required disabled={connections.length === 0}>{connections.map((item) => <option key={item.id} value={item.id}>{item.label} · @{item.github_login}</option>)}</select></label>
        <label>Repositório<input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="https://github.com/owner/nome" required disabled={connections.length === 0} /></label>
        <button className="primary" type="submit" disabled={connections.length === 0}>Ler do GitHub</button>
      </form>
      <div className="cards">
        {rows.length === 0 ? <p className="empty">Nenhum repositório lido. O painel não inventa projeto.</p> : null}
        {rows.map((repo) => (
          <article className="card" key={repo.id}>
            <header><strong>{repo.full_name}</strong><span className="tag">{repo.visibility}</span></header>
            <p className="muted">{repo.last_remote_check_at ? `Lido do GitHub em ${new Date(repo.last_remote_check_at).toLocaleString("pt-BR")}` : "Ainda sem leitura confirmada do GitHub"} · {repo.sync_status}</p>
            {repo.html_url ? <a href={repo.html_url}>{repo.html_url}</a> : <p className="error">Sem URL do GitHub. Este registro não foi confirmado.</p>}
            {repo.sync_error ? <p className="error">{repo.sync_error}</p> : null}
            <button className="ghost" onClick={() => onOpen(repo.id)}>Abrir ficha</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Detail({ id, onBack, onChange, onNotice }: { id: string; onBack: () => void; onChange: () => Promise<void>; onNotice: (text: string) => void }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [featureName, setFeatureName] = useState("");
  const [openCommit, setOpenCommit] = useState<string | null>(null);

  async function load() {
    const [repoRow, commitRows, featureRows, languageRows, runRows] = await Promise.all([
      supabase.from("panel_repositories").select("*").eq("id", id).maybeSingle(),
      supabase.from("panel_commits").select("*").eq("repository_id", id).order("committed_at", { ascending: false }).limit(50),
      supabase.from("panel_features").select("*").eq("repository_id", id).order("position"),
      supabase.from("panel_languages").select("*").eq("repository_id", id),
      supabase.from("panel_sync_runs").select("*").eq("repository_id", id).order("started_at", { ascending: false }).limit(5),
    ]);
    setRepo(repoRow.data);
    setCommits(commitRows.data ?? []);
    setFeatures(featureRows.data ?? []);
    setLanguages(languageRows.data ?? []);
    setRuns(runRows.data ?? []);
    const ids = (commitRows.data ?? []).map((item) => item.id);
    if (ids.length) {
      const fileRows = await supabase.from("panel_commit_files").select("*").in("commit_id", ids);
      setFiles(fileRows.data ?? []);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!repo) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    await api(`/repositories/${repo.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        showcase_title: form.get("showcase_title"),
        showcase_summary: form.get("showcase_summary"),
        highlight: form.get("highlight"),
        highlight_public: form.get("highlight_public") === "on",
        internal_note: form.get("internal_note"),
        project_type: form.get("project_type"),
        code_kind: form.get("code_kind"),
        visibility: form.get("visibility"),
        paused: form.get("paused") === "on",
        history_limit: Number(form.get("history_limit") || 100),
      }),
    });
    onNotice("Ficha atualizada.");
    await load();
    await onChange();
  }

  if (!repo) return <p>Carregando a ficha…</p>;
  return (
    <section className="stack">
      <button className="ghost" onClick={onBack}>Voltar</button>
      <header className="row"><h2>{repo.full_name}</h2>{repo.html_url ? <a href={repo.html_url}>{repo.html_url}</a> : null}</header>
      <p className="muted">{repo.is_private ? "Privado no GitHub" : "Público no GitHub"} · {repo.sync_mode} · {repo.sync_status}{repo.last_remote_check_at ? ` · última leitura ${new Date(repo.last_remote_check_at).toLocaleString("pt-BR")}` : ""}</p>
      {repo.sync_error ? <p className="error">{repo.sync_error}</p> : null}
      <button className="primary" onClick={async () => { await api(`/repositories/${repo.id}/sync`, { method: "POST" }); onNotice("Fatia pedida."); await load(); }}>Sincronizar agora</button>
      <div className="bars">
        {languages.map((item) => (
          <div className="bar" key={item.language}><span>{item.language}</span><i style={{ width: `${item.percent}%` }} /><span>{item.percent}%</span></div>
        ))}
      </div>
      <form className="stack" key={repo.updated_at ?? repo.id} onSubmit={save}>
        <label>Título na vitrine<input name="showcase_title" defaultValue={repo.showcase_title ?? ""} /></label>
        <label>Resumo<textarea name="showcase_summary" defaultValue={repo.showcase_summary ?? ""} /></label>
        <label>O que este projeto prova<textarea name="highlight" defaultValue={repo.highlight ?? ""} /></label>
        <label><span>Mostrar o destaque na vitrine</span><input name="highlight_public" type="checkbox" defaultChecked={repo.highlight_public} /></label>
        <label>Nota interna<textarea name="internal_note" defaultValue={repo.internal_note ?? ""} /></label>
        <label>Tipo de código<select name="code_kind" defaultValue={repo.code_kind ?? ""}><option value="">—</option>{CODE_KINDS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
        <label>Tipo de projeto<select name="project_type" defaultValue={repo.project_type ?? ""}><option value="">—</option>{PROJECT_TYPES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
        <label>Visibilidade<select name="visibility" defaultValue={repo.visibility}><option value="interno">Interno</option><option value="vitrine">Vitrine</option></select></label>
        <label><span>Pausar acompanhamento</span><input name="paused" type="checkbox" defaultChecked={repo.paused} /></label>
        <label>Quantos commits ler do GitHub<input name="history_limit" type="number" min={1} max={500} defaultValue={repo.history_limit ?? 100} required /></label>
        <button className="primary" type="submit">Salvar classificação</button>
      </form>
      <form className="stack" onSubmit={async (event) => {
        event.preventDefault();
        await api("/features", { method: "POST", body: JSON.stringify({ repository_id: repo.id, name: featureName, position: features.length }) });
        setFeatureName("");
        await load();
      }}>
        <h3>Funcionalidades ({features.length})</h3>
        {features.map((feature) => (
          <div className="stack" key={feature.id}>
            <p>{feature.name}{feature.description ? ` — ${feature.description}` : ""}{feature.show_in_showcase ? "" : " · fora da vitrine"}</p>
            <button type="button" className="ghost" onClick={async () => { await api(`/features/${feature.id}`, { method: "DELETE" }); await load(); }}>Remover</button>
          </div>
        ))}
        <label>Nova funcionalidade<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} required /></label>
        <button type="submit">Adicionar</button>
      </form>
      <section>
        <h3>Commits</h3>
        {commits.map((commit) => (
          <article key={commit.id} className="stack">
            <div className="event">
              <time>{new Date(commit.committed_at).toLocaleString("pt-BR")}</time>
              <div>
                <p>{commit.message.split("\n")[0]}</p>
                <p className="sha">+{commit.additions ?? "?"} −{commit.deletions ?? "?"}</p>
                <a href={`https://github.com/${repo.full_name}/commit/${commit.sha}`}>{commit.sha.slice(0, 8)} no GitHub</a>
                <button type="button" className="ghost" onClick={() => setOpenCommit(openCommit === commit.id ? null : commit.id)}>{openCommit === commit.id ? "Fechar" : "Mensagem da vitrine"}</button>
              </div>
            </div>
            {openCommit === commit.id ? (
              <form className="stack" onSubmit={async (event) => {
                event.preventDefault();
                const message = String(new FormData(event.currentTarget).get("showcase_message") ?? "");
                await api(`/commits/${commit.id}`, { method: "PATCH", body: JSON.stringify({ showcase_message: message }) });
                onNotice("Mensagem da vitrine gravada.");
                await load();
              }}>
                <ul className="files">{files.filter((file) => file.commit_id === commit.id).map((file) => <li key={file.id}>{file.status} {file.filename}</li>)}</ul>
                <label>Mensagem publicada na vitrine<textarea name="showcase_message" defaultValue={commit.showcase_message ?? ""} /></label>
                <button type="submit">Publicar mensagem</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
      <section>
        <h3>Últimas sincronizações</h3>
        {runs.map((run) => <p key={run.id}>{new Date(run.started_at).toLocaleString("pt-BR")} · {run.trigger} · {run.status}{run.error ? ` · ${run.error}` : ""}</p>)}
      </section>
      <p className="muted">{label(CODE_KINDS, repo.code_kind)} · {label(PROJECT_TYPES, repo.project_type)}</p>
    </section>
  );
}
