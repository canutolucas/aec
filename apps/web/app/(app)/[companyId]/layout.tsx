import { listAccountProfiles, ROLE_LABELS } from "@aec/db";
import { Logo, ThemeToggle } from "@aec/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { topLevelNav } from "@/lib/ui/nav-groups";
import { routes } from "@/lib/ui/routes";

import { MobileTabBar } from "./mobile-tab-bar";
import { PerfilSelector } from "./perfil-selector";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabaseSSR = await createServerSupabase();
  // Melhor esforco: o layout nao tem error.tsx proprio (so cada rota abaixo
  // dele tem) -- uma falha aqui (rede, RLS, ou a migration de perfis ainda
  // nao aplicada em producao) derrubaria TODA pagina da empresa, nao so o
  // seletor de perfis. Sem perfil nenhum, o seletor global so fica oculto.
  const perfis = await listAccountProfiles(supabaseSSR, companyId).catch(() => []);

  // Fase 2b: uma navegacao so, pra qualquer papel e qualquer modo — ver
  // apps/web/lib/ui/nav-groups.ts. 9-11 itens (Hoje, Painel, Lancamentos,
  // Contas, Conciliacao, Faturamento, Recebimentos, Relatorios, Cadastros,
  // Equipe) viram 5 grupos (Hoje sozinho + 4 com sub-abas); simpleMode nao
  // troca mais a navegacao inteira, so esconde a aba Cadastros dentro de
  // Ajustes.
  const nav = topLevelNav(session.role, session.simpleMode);

  async function sair() {
    "use server";
    const supabase = await createServerSupabase();
    await supabase.auth.signOut();
    redirect(routes.login);
  }

  return (
    <div className="min-h-screen">
      <header className="border-border bg-card border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Logo className="text-lg" />
            <div className="border-border min-w-0 border-l pl-3">
              <p className="truncate text-sm font-semibold">{session.company.name}</p>
              <p className="text-muted-foreground text-xs">{ROLE_LABELS[session.role]}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Suspense fallback={null}>
              <PerfilSelector perfis={perfis} />
            </Suspense>
            <ThemeToggle />
            {session.companies.length > 1 && (
              <Link
                href={routes.companies}
                className="text-muted-foreground text-xs underline-offset-2 hover:underline"
              >
                Trocar empresa
              </Link>
            )}
            <form action={sair}>
              <button
                type="submit"
                className="text-muted-foreground text-xs underline-offset-2 hover:underline"
              >
                Sair
              </button>
            </form>
          </div>
        </div>

        {/*
         * 5 itens cabem numa linha em qualquer largura de desktop — a
         * rolagem horizontal (`overflow-x-auto`) fica so como rede de
         * seguranca pra uma tela bem estreita. Abaixo de `md:` esse `<nav>`
         * some e da lugar a <MobileTabBar>, a mesma barra de abas fixa no
         * rodape pra qualquer papel/modo agora (antes so existia no modo
         * avancado).
         */}
        <nav className="mx-auto hidden max-w-7xl overflow-x-auto px-4 md:block">
          <ul className="flex flex-nowrap gap-1">
            {nav.map((item) => (
              <li key={item.key} className="shrink-0">
                <Link
                  href={item.href(companyId)}
                  className="text-muted-foreground hover:border-border hover:text-foreground -mb-px block border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <MobileTabBar companyId={companyId} role={session.role} simpleMode={session.simpleMode} />

      {/* pb-20 no celular pra conteudo nao ficar embaixo da MobileTabBar fixa; pt-6/pb-6 explicitos (em vez de py-6) pra nao colidir com o pb-20/md:pb-6 na mesma propriedade */}
      <main className="mx-auto max-w-7xl px-4 pt-6 pb-20 md:pb-6">{children}</main>
    </div>
  );
}
