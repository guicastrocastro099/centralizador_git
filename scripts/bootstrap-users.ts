import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensure(email: string | undefined, password: string | undefined, role: "administrator" | "viewer") {
  if (!email || !password) {
    console.log(`pulando ${role}: e-mail ou senha ausentes`);
    return;
  }
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !created.error.message.toLowerCase().includes("already")) {
    throw created.error;
  }
  const listed = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = listed.data.users.find((item) => item.email === email);
  if (!user) throw new Error(`usuario ${role} nao encontrado depois da criacao`);
  const { error } = await admin.rpc("op_set_profile", { p_user_id: user.id, p_role: role });
  if (error) throw error;
  console.log(`${role} pronto: ${email}`);
}

await ensure(process.env.BOOTSTRAP_OPERATOR_EMAIL, process.env.BOOTSTRAP_OPERATOR_PASSWORD, "administrator");
await ensure(process.env.BOOTSTRAP_VIEWER_EMAIL, process.env.BOOTSTRAP_VIEWER_PASSWORD, "viewer");
