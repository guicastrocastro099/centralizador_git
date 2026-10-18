import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { Login } from "./screens/Login";
import { Operator } from "./screens/Operator";
import { Showcase } from "./screens/Showcase";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<"administrator" | "viewer" | null>(null);
  const [roleError, setRoleError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setRole(null);
      return;
    }
    supabase.from("my_profile").select("app_role").maybeSingle().then(({ data, error }) => {
      if (error || (data?.app_role !== "administrator" && data?.app_role !== "viewer")) {
        setRole(null);
        setRoleError("Esta conta não tem papel neste centralizador.");
        return;
      }
      setRoleError("");
      setRole(data.app_role);
    });
  }, [session]);

  if (!ready) return <main className="login"><p>Abrindo…</p></main>;
  if (!supabaseConfigured) {
    return (
      <main className="login">
        <form className="stack card">
          <h1>Centralizador</h1>
          <p>GitHub deste projeto: <a href="https://github.com/guicastrocastro099/centralizador_git">guicastrocastro099/centralizador_git</a></p>
          <p>Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para entrar.</p>
        </form>
      </main>
    );
  }
  if (!session) return <Login />;
  if (roleError) {
    return (
      <main className="login">
        <form className="stack card" onSubmit={(event) => { event.preventDefault(); supabase.auth.signOut(); }}>
          <p>{roleError}</p>
          <button className="primary" type="submit">Sair</button>
        </form>
      </main>
    );
  }
  if (!role) return <main className="login"><p>Conferindo o acesso…</p></main>;
  if (role === "viewer") return <Showcase onSignOut={() => supabase.auth.signOut()} />;
  return <Operator onSignOut={() => supabase.auth.signOut()} />;
}
