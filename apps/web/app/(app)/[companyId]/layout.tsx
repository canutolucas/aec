import { hasRole, listAccountProfiles, ROLE_LABELS } from "@aec/db";
import { cn, Logo, ThemeToggle } from "@aec/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { routes } from "@/lib/ui/routes";

import { MobileTabBar } from "./mobile-tab-bar";
import { PerfilSelector } from "./perfil-selector";

const NAV = [
  { key: "hoje", label: "Hoje", href: routes.today },
  { key: "painel", label: "Painel", href: routes.dashboard },
  { key: "lancamentos", label: "Lancamentos", href: (id: string) => routes.transactions(id) },
  { key: "contas", label: "Contas", href: routes.accounts },
  { key: "conciliacao", label: "Conciliacao", href: routes.reconciliation },
  { key: "faturamento", label: "Faturamento", href: routes.invoices },
  { key: "recebimentos", label: "Recebimentos", href: routes.receivables },
  { key: "relatorios", label: "Relatorios", href: routes.reports },
  { key: "cadastros", label: "Cadastros", href: routes.registries },
  { key: "equipe", label: "Equipe", href: routes.team },
] as const;

/**
 * No modo simples so existem tres paginas: Inicio, e Faturamento/
 * Recebimentos — essas duas ficam de fora de requireAdvancedAccess de
 * proposito (equipe/faturamento/recebimentos/page.tsx usam requireCompany),
 * porque sao tarefa do dia a dia de quem opera o sistema no modo simples,
 * nao um recurso avancado. Os outros 4 itens levam a telas que
 * requireAdvancedAccess() ja redireciona de volta pra ca, entao mostra-los
 * aqui so criaria um link que bate e volta.
 *
 * Equipe e outra excecao: e a unica tela que desliga o modo simples
 * (alternarModoSimples), e por isso o proprio equipe/page.tsx tambem NAO usa
 * requireAdvancedAccess — sem ela visivel aqui, um owner que ligasse o modo
 * simples em si mesmo ficaria sem nenhum link de volta, so um URL digitado
 * a mao. So aparece para quem tem papel de owner (quem realmente pode usar
 * o controle la dentro).
 */
function simpleNav(role: Parameters<typeof hasRole>[0]) {
  const base = [
    { key: "hoje", label: "Hoje", href: routes.today },
    { key: "inicio", label: "Inicio", href: routes.home },
    { key: "faturamento", label: "Faturamento", href: routes.invoices },
    { key: "recebimentos", label: "Recebimentos", href: routes.receivables },
  ] as const;
  return hasRole(role, "owner")
    ? ([...base, { key: "equipe", label: "Equipe", href: routes.team }] as const)
    : base;
}

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
  const perfis = await listAccountProfiles(supabaseSSR, companyId);

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
         * Com 9 itens (menu avancado), a lista nao cabe na largura de um
         * celular. Acima de `md:` continua a rolagem horizontal
         * (`overflow-x-auto` + `flex-nowrap`, o padrao ja usado nas tabelas
         * largas do sistema); abaixo de `md:` esse `<nav>` some e da lugar a
         * <MobileTabBar>, a barra de abas fixa no rodape. No modo simples
         * (3-4 itens) a lista ja cabe numa linha em qualquer largura, entao
         * fica so a rolagem, sem barra dedicada.
         */}
        <nav
          className={cn(
            "mx-auto max-w-7xl overflow-x-auto px-4",
            !session.simpleMode && "hidden md:block",
          )}
        >
          <ul className="flex flex-nowrap gap-1">
            {(session.simpleMode ? simpleNav(session.role) : NAV).map((item) => (
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

      {!session.simpleMode && <MobileTabBar companyId={companyId} />}

      {/* pb-20 no celular pra conteudo nao ficar embaixo da MobileTabBar fixa; pt-6/pb-6 explicitos (em vez de py-6) pra nao colidir com o pb-20/md:pb-6 na mesma propriedade */}
      <main className="mx-auto max-w-7xl px-4 pt-6 pb-20 md:pb-6">{children}</main>
    </div>
  );
}
