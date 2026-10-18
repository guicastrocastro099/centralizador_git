import { useEffect, useState } from "react";
import { CODE_KINDS, PROJECT_TYPES, label } from "../labels";
import { supabase } from "../lib/supabase";

type Repo = {
  id: string;
  showcase_title: string;
  showcase_summary: string | null;
  project_type: string | null;
  code_kind: string | null;
  highlight: string | null;
  feature_count: number;
};
type Commit = { id: string; repository_id: string; showcase_message: string; committed_at: string; additions: number | null; deletions: number | null };
type Language = { repository_id: string; language: string; percent: number };
type Feature = { id: string; repository_id: string; name: string; description: string | null };

export function Showcase({ onSignOut }: { onSignOut: () => void }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [open, setOpen] = useState<Repo | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [codeKind, setCodeKind] = useState("");
  const [projectType, setProjectType] = useState("");
  const [language, setLanguage] = useState("");

  useEffect(() => {
    supabase.from("showcase_repositories").select("*").then(({ data }) => setRepos(data ?? []));
    supabase.from("showcase_languages").select("*").then(({ data }) => setLanguages(data ?? []));
  }, []);

  useEffect(() => {
    if (!open) return;
    supabase.from("showcase_commits").select("*").eq("repository_id", open.id).order("committed_at", { ascending: false }).then(({ data }) => setCommits(data ?? []));
    supabase.from("showcase_features").select("*").eq("repository_id", open.id).order("position").then(({ data }) => setFeatures(data ?? []));
  }, [open]);

  const languageIds = new Set(languages.filter((item) => item.language === language).map((item) => item.repository_id));
  const visible = repos.filter((repo) => {
    if (codeKind && repo.code_kind !== codeKind) return false;
    if (projectType && repo.project_type !== projectType) return false;
    if (language && !languageIds.has(repo.id)) return false;
    return true;
  });

  return (
    <div className="shell">
      <header className="top">
        <div className="brand"><strong>Vitrine</strong><span>Projetos publicados, sem o endereço do GitHub.</span></div>
        <button className="ghost" onClick={onSignOut}>Sair</button>
      </header>
      <main className="page">
        <div className="filters">
          <select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">Linguagem</option>{[...new Set(languages.map((item) => item.language))].map((item) => <option key={item}>{item}</option>)}</select>
          <select value={codeKind} onChange={(event) => setCodeKind(event.target.value)}><option value="">Tipo de código</option>{CODE_KINDS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
          <select value={projectType} onChange={(event) => setProjectType(event.target.value)}><option value="">Tipo de projeto</option>{PROJECT_TYPES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
        </div>
        {open ? (
          <section className="panel stack">
            <button className="ghost" onClick={() => setOpen(null)}>Voltar</button>
            <h2>{open.showcase_title}</h2>
            <p>{open.showcase_summary}</p>
            <div className="tags">
              <span className="tag">{label(CODE_KINDS, open.code_kind)}</span>
              <span className="tag">{label(PROJECT_TYPES, open.project_type)}</span>
              <span className="tag">{open.feature_count} funcionalidades</span>
            </div>
            {open.highlight ? <p>{open.highlight}</p> : null}
            <h3>Funcionalidades</h3>
            {features.map((feature) => <article key={feature.id}><strong>{feature.name}</strong><p className="muted">{feature.description}</p></article>)}
            <h3>O que foi feito</h3>
            {commits.map((commit) => (
              <article className="event" key={commit.id}>
                <time>{new Date(commit.committed_at).toLocaleDateString("pt-BR")}</time>
                <div><p>{commit.showcase_message}</p><p className="muted">+{commit.additions ?? 0} −{commit.deletions ?? 0}</p></div>
              </article>
            ))}
          </section>
        ) : (
          <section className="cards">
            {visible.map((repo) => (
              <button className="card" key={repo.id} onClick={() => setOpen(repo)}>
                <h2>{repo.showcase_title}</h2>
                <p>{repo.showcase_summary}</p>
                <p className="muted">{repo.feature_count} funcionalidades</p>
              </button>
            ))}
            {visible.length === 0 ? <p>Nenhum projeto na vitrine com esses filtros.</p> : null}
          </section>
        )}
      </main>
    </div>
  );
}
