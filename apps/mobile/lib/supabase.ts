import type { Database } from "@aec/db";
import { createClient } from "@supabase/supabase-js";

import { largeSecureStore } from "./large-secure-store";

function requireEnv(name: "EXPO_PUBLIC_SUPABASE_URL" | "EXPO_PUBLIC_SUPABASE_ANON_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name} no arquivo .env do app mobile.`);
  return value;
}

export const supabase = createClient<Database>(
  requireEnv("EXPO_PUBLIC_SUPABASE_URL"),
  requireEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
  {
    auth: {
      // Plain SecureStore rejects (or on some Android builds silently
      // truncates) values above ~2KB — easy for a Supabase session to
      // exceed. `largeSecureStore` transparently splits/reunites larger
      // values across sibling keys; see its own comment for the failure
      // mode this avoids.
      storage: largeSecureStore,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
