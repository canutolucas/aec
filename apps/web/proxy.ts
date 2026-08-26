/**
 * Renova a sessao do Supabase a cada requisicao e barra o acesso anonimo.
 *
 * Convencao `proxy` do Next 16, que substituiu `middleware`.
 *
 * O redirecionamento aqui e comodidade de navegacao. A protecao de verdade e o
 * RLS no banco: sem sessao valida, `auth.uid()` e nulo e nenhuma policy libera
 * uma linha sequer. Se este arquivo fosse removido por engano, o sistema ficaria
 * feio, nao inseguro.
 */

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_ROUTES = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_ROUTES.some((route) => path.startsWith(route));

  if (!data.user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Guarda o destino para devolver a pessoa onde ela estava depois do login.
    login.searchParams.set("destino", path);
    return NextResponse.redirect(login);
  }

  if (data.user && path === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  // O icone do app (icon.tsx, apple-icon.tsx, manifest.ts, icons/*) precisa
  // ser servido a QUALQUER um, logado ou nao — e assim que o navegador busca
  // o favicon da propria tela de login, e como o SO busca o manifest/icone
  // para "Adicionar a tela de inicio" antes mesmo de a pessoa autenticar.
  // Essas rotas nao tem extensao (`/icon`, `/apple-icon`, `/icons/192`) ou
  // usam uma extensao fora da lista de imagem abaixo (`manifest.webmanifest`),
  // entao precisam de exclusao propria — a mesma logica que ja poupa
  // favicon.ico do redirecionamento para /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon$|apple-icon$|icons/|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
