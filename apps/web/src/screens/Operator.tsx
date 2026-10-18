import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { CODE_KINDS, PROJECT_TYPES, label } from "../labels";
import { supabase } from "../lib/supabase";

type Tab = "tempo" | "repos" | "conexoes";
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
  const [tab, setTab] = useState<Tab>("repos");
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
          <a href="https://github.com/guicastrocastro099/centralizador_git">guicastrocastro099/centralizador_git</a>
        </div>
        <nav className="nav">
          <button aria-current={tab === "tempo" ? "page" : undefined} onClick={() => { setTab("tempo"); setSelected(null); }}>Linha do tempo</button>
          <button aria-current={tab === "repos" ? "page" : undefined} onClick={() => setTab("repos")}>Repositórios</button>
          <button aria-current={tab === "conexoes" ? "page" : undefined} onClick={() => setTab("conexoes")}>Conexões</button>
          <button onClick={onSignOut}>Sair</button>
        </nav>
      </header>
      <main className="page">
        {notice ? <p className={notice.startsWith("Erro") ? "error" : "ok"}>{notice}</p> : null}
        <Filters language={language} languages={languages} codeKind={codeKind} projectType={projectType} visibility={visibility} paused={paused} onLanguage={setLanguage} onCode={setCodeKind} onProject={setProjectType} onVisibility={setVisibility} onPaused={setPaused} />
        {tab === "tempo" && !selected ? <Timeline commits={commits.filter(repoPass)} onOpen={(id) => { setSelected(id); setTab("repos"); }} /> : null}
        {tab === "conexoes" ? <Connections rows={connections} onChange={load} onNotice={setNotice} /> : null}
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
  if (commits.length === 0) return <p>Nenhum commit com esses filtros.</p>;
  return (
    <section className="timeline">
      {commits.map((commit) => (
        <button className="event" key={commit.id} onClick={() => onOpen(commit.repository_id)}>
          <time>{new Date(commit.committed_at).toLocaleString("pt-BR")}</time>
          <div>
            <strong>{commit.full_name}</strong>
            <p>{commit.message.split("\n")[0]}</p>
            <p className="muted">{commit.author_name} · +{commit.additions ?? "?"} −{commit.deletions ?? "?"} · {commit.files_changed ?? "?"} arquivos</p>
          </div>
        </button>
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
        <h2>Nova conta GitHub</h2>
        <label>Rótulo<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
        <label>Token<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label>
        <button className="primary" type="submit">Guardar chave</button>
      </form>
      {rows.map((row) => (
        <article className="card" key={row.id}>
          <header><strong>{row.label}</strong><span className="muted">{row.github_login}</span></header>
          <button className="ghost" onClick={async () => { await api(`/connections/${row.id}`, { method: "DELETE" }); await onChange(); }}>Remover</button>
        </article>
      ))}
    </section>
  );
}

function RepoList({ rows, connections, onOpen, onChange, onNotice }: { rows: Repo[]; connections: Connection[]; onOpen: (id: string) => void; onChange: () => Promise<void>; onNotice: (text: string) => void }) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const [fullName, setFullName] = useState("guicastrocastro099/centralizador_git");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/repositories", { method: "POST", body: JSON.stringify({ connection_id: connectionId, full_name: fullName }) });
      setFullName("");
      onNotice("Repositório incluído. A primeira fatia de commits já foi pedida.");
      await onChange();
    } catch (error) {
      onNotice(`Erro: ${error instanceof Error ? error.message : "falha"}`);
    }
  }

  return (
    <section className="grid">
      <form className="stack" onSubmit={submit}>
        <h2>Incluir repositório</h2>
        <label>Conta<select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>{connections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>owner/nome<input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="org/projeto" required /></label>
        <button className="primary" type="submit">Acompanhar</button>
      </form>
      <div className="cards">
        {rows.some((repo) => repo.full_name === "guicastrocastro099/centralizador_git") ? null : (
          <a className="card" href="https://github.com/guicastrocastro099/centralizador_git">
            <header><strong>guicastrocastro099/centralizador_git</strong><span className="tag">GitHub</span></header>
            <p className="muted">Repositório deste projeto. Entre com uma chave em Conexões e use Acompanhar para gravar os commits.</p>
          </a>
        )}
        {rows.map((repo) => (
          <button className="card" key={repo.id} onClick={() => onOpen(repo.id)}>
            <header><strong>{repo.full_name}</strong><span className="tag">{repo.visibility}</span></header>
            <p className="muted">{repo.feature_count} funcionalidades · {repo.sync_status}{repo.backfill_done ? "" : " · carga em andamento"}</p>
            {repo.sync_error ? <p className="error">{repo.sync_error}</p> : null}
          </button>
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
      <header className="row"><h2>{repo.full_name}</h2><a href={repo.html_url ?? undefined}>{repo.html_url}</a></header>
      <p className="muted">{repo.is_private ? "Privado" : "Público"} · {repo.sync_mode} · {repo.sync_status}</p>
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
        <button className="primary" type="submit">Salvar classificação</button>
      </form>
      <form className="stack" onSubmit={async (event) => {
        event.preventDefault();
        await api("/features", { method: "POST", body: JSON.stringify({ repository_id: repo.id, name: featureName, position: features.length }) });
        setFeatureName("");
        await load();
      }}>
        <h3>Funcionalidades ({features.length})</h3>
        {features.map((feature) => <p key={feature.id}>{feature.name}</p>)}
        <label>Nova funcionalidade<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} required /></label>
        <button type="submit">Adicionar</button>
      </form>
      <section>
        <h3>Commits</h3>
        {commits.map((commit) => (
          <article key={commit.id} className="stack">
            <button className="event" onClick={() => setOpenCommit(openCommit === commit.id ? null : commit.id)}>
              <time>{new Date(commit.committed_at).toLocaleString("pt-BR")}</time>
              <div><p>{commit.message.split("\n")[0]}</p><p className="sha">{commit.sha.slice(0, 8)} · +{commit.additions ?? "?"} −{commit.deletions ?? "?"}</p></div>
            </button>
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
