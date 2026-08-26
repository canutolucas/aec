/**
 * Clientes do Supabase.
 *
 * Nenhum deles usa a service role: toda consulta da aplicacao passa pelo RLS,
 * autenticada como a pessoa que esta usando o sistema. Um cliente com service
 * role atravessaria o isolamento entre empresas e tornaria todas as policies
 * decorativas — por isso ele nao existe aqui, so em scripts administrativos.
 *
 * Parametrizado com `Database` (gerado por packages/db/scripts/generate-types.mjs
 * a partir do schema real): uma coluna renomeada numa migration agora quebra
 * o type-check em todo `.from(...)` que a usa, em vez de só aparecer em
 * produção como undefined silencioso atrás de um `as X[]`.
 */

import type { Database } from "@aec/db";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variavel de ambiente ${name} nao configurada. Copie .env.example para .env.local e preencha.`,
    );
  }
  return value;
}

export function createClient() {
  return createBrowserClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component nao pode escrever cookie. O middleware ja cuida
            // da renovacao da sessao, entao aqui e seguro ignorar.
          }
        },
      },
    },
  );
}
