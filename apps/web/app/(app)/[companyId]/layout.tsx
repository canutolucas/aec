import { hasRole, ROLE_LABELS } from "@aec/db";
import { Logo } from "@aec/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { routes } from "@/lib/ui/routes";

const NAV = [
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

        <nav className="mx-auto max-w-7xl px-4">
          <ul className="flex gap-1">
            {(session.simpleMode ? simpleNav(session.role) : NAV).map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href(companyId)}
                  className="text-muted-foreground hover:border-border hover:text-foreground -mb-px block border-b-2 border-transparent px-3 py-2 text-sm"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
