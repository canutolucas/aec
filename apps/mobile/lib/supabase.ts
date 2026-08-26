import type { Database } from "@aec/db";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

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
      storage: {
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) => SecureStore.setItemAsync(key, value),
        removeItem: (key) => SecureStore.deleteItemAsync(key),
      },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
