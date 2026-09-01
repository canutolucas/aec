/**
 * Onde todo link de e-mail do Supabase Auth aterrissa — confirmacao de
 * cadastro (signUp) e redefinicao de senha (resetPasswordForEmail) usam o
 * mesmo caminho, so muda o `next` que cada um pede.
 *
 * Troca o `code` (fluxo PKCE, o padrao do supabase-js atual) pela sessao real
 * — e so depois disso que a pessoa fica autenticada. `/auth` ja esta em
 * PUBLIC_ROUTES (proxy.ts): sem sessao ainda, essa rota precisa ser
 * alcancavel.
 */

import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/db/supabase";
import { routes, safeDestination } from "@/lib/ui/routes";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeDestination(url.searchParams.get("next") ?? undefined);

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  // Link expirado, ja usado, ou sem `code` nenhum — nao ha como recuperar a
  // sessao aqui. Volta para o login com um aviso, em vez de um erro cru.
  return NextResponse.redirect(new URL(routes.login + "?erro=link-invalido", url.origin));
}
