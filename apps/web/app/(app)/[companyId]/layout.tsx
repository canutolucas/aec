import { ROLE_LABELS } from "@aec/db";
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
  { key: "cadastros", label: "Cadastros", href: routes.registries },
] as const;

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
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{session.company.name}</p>
            <p className="text-muted-foreground text-xs">{ROLE_LABELS[session.role]}</p>
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
            {NAV.map((item) => (
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
