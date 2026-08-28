"use client";

import type { MemberRole } from "@aec/db";
import { cn } from "@aec/ui";
import {
  ArrowLeftRight,
  BarChart3,
  CalendarCheck,
  FileText,
  type LucideIcon,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS, topLevelNav } from "@/lib/ui/nav-groups";

const ICONS: Record<string, LucideIcon> = {
  hoje: CalendarCheck,
  movimentos: ArrowLeftRight,
  notas: FileText,
  relatorios: BarChart3,
  ajustes: Settings,
};

/**
 * Barra de abas fixa no rodape pro celular — Fase 2b: os 5 grupos da
 * navegacao de topo (ver nav-groups.ts) cabem inteiros aqui, sem precisar
 * de folha "Mais" como antes (9-11 itens nao cabiam; 5 cabem). A mesma
 * barra agora serve qualquer papel/modo — antes so existia no modo
 * avancado.
 */
export function MobileTabBar({
  companyId,
  role,
  simpleMode,
}: {
  companyId: string;
  role: MemberRole;
  simpleMode: boolean;
}) {
  const pathname = usePathname();
  const itens = topLevelNav(role, simpleMode);

  return (
    <nav
      className="border-border bg-card fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex">
        {itens.map((item) => {
          // "Hoje" so bate com a propria rota; os grupos batem com qualquer
          // uma das suas sub-abas (ex.: /lancamentos E /conciliacao acendem
          // "Movimentos").
          const group =
            item.key in NAV_GROUPS ? NAV_GROUPS[item.key as keyof typeof NAV_GROUPS] : null;
          const ativo = group
            ? group.items.some((subItem) => pathname.includes(`/${subItem.key}`))
            : pathname.includes(`/${item.key}`);
          const Icon = ICONS[item.key] ?? CalendarCheck;

          return (
            <li key={item.key} className="min-w-0 flex-1">
              <Link
                href={item.href(companyId)}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-[11px]",
                  ativo ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
