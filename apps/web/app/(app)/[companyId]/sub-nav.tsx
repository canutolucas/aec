import { cn } from "@aec/ui";
import Link from "next/link";

import type { SessionContext } from "@/lib/db/session";
import { NAV_GROUPS, type NavGroupKey, visibleItems } from "@/lib/ui/nav-groups";

/**
 * Sub-navegação em abas para um grupo (Movimentos, Notas, Relatórios,
 * Ajustes — ver nav-groups.ts). Cada aba é uma rota que já existia antes da
 * Fase 2b e continua funcionando exatamente igual — isto é só a casca de
 * apresentação que agrupa telas relacionadas sob um único item do menu
 * principal, sem fundir nenhuma lógica.
 */
export function SubNav({
  group,
  active,
  companyId,
  session,
}: {
  group: NavGroupKey;
  active: string;
  companyId: string;
  session: Pick<SessionContext, "role" | "simpleMode">;
}) {
  const items = visibleItems(NAV_GROUPS[group], session.role, session.simpleMode);
  if (items.length <= 1) return null;

  return (
    <nav className="border-border -mt-2 mb-4 overflow-x-auto border-b">
      <ul className="flex flex-nowrap gap-1">
        {items.map((item) => (
          <li key={item.key} className="shrink-0">
            <Link
              href={item.href(companyId)}
              className={cn(
                "-mb-px block border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                item.key === active
                  ? "border-primary text-foreground font-medium"
                  : "text-muted-foreground hover:border-border hover:text-foreground border-transparent",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
