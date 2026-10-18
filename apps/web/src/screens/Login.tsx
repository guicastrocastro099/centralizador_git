import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (authError) setError("E-mail ou senha não conferem.");
  }

  return (
    <main className="login">
      <form className="stack card" onSubmit={submit}>
        <div>
          <h1>Centralizador</h1>
          <p className="muted">Depois de entrar, a tela mostra o repositório como o GitHub o devolve.</p>
        </div>
        <label>E-mail<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
        <p className="muted">Sem chave, não há repositório para mostrar.</p>
      </form>
    </main>
  );
}
