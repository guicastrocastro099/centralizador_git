import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "https://mjmnueuoyhruytgiogoc.supabase.co";
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qbW51ZXVveWhydXl0Z2lvZ29jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMjg2NTIsImV4cCI6MjEwNzkwNDY1Mn0.sWAquesNxzUFx6Z-KsfFkJV_dtnzp-6C5De9xVgDKys";

export const supabaseConfigured = Boolean(url && anon);

export const supabase = createClient(url || "http://localhost", anon || "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
