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
import { NextResponse, type NextRequest } from "next/server";

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
