"use client";

import { cn } from "@aec/ui";
import {
  ArrowLeftRight,
  BarChart3,
  CheckCheck,
  ClipboardList,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  Users,
  X,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { routes } from "@/lib/ui/routes";

type Item = { key: string; label: string; href: (id: string) => Route; icon: LucideIcon };

/**
 * As 4 telas de uso diario do fluxo bancario/contabil ficam fixas na barra;
 * as outras 5 do menu avancado vao atras de "Mais" — escolha feita com o
 * usuario, nao inferida do codigo (ver plano desta leva).
 */
const PRINCIPAIS: Item[] = [
  { key: "painel", label: "Painel", href: routes.dashboard, icon: LayoutDashboard },
  {
    key: "lancamentos",
    label: "Lancamentos",
    href: (id) => routes.transactions(id),
    icon: ArrowLeftRight,
  },
  { key: "conciliacao", label: "Conciliacao", href: routes.reconciliation, icon: CheckCheck },
  { key: "faturamento", label: "Faturamento", href: routes.invoices, icon: FileText },
];

const MAIS: Item[] = [
  { key: "recebimentos", label: "Recebimentos", href: routes.receivables, icon: HandCoins },
  { key: "contas", label: "Contas", href: routes.accounts, icon: Landmark },
  { key: "relatorios", label: "Relatorios", href: routes.reports, icon: BarChart3 },
  { key: "cadastros", label: "Cadastros", href: routes.registries, icon: ClipboardList },
  { key: "equipe", label: "Equipe", href: routes.team, icon: Users },
];

/**
 * Barra de abas fixa no rodape para o menu avancado no celular — so
 * `md:hidden`, o `<nav>` horizontal continua existindo para telas maiores
 * (ver layout.tsx). Substitui a rolagem horizontal de 9 itens, que nao cabia
 * numa tela de celular sem virar leitura as cegas.
 */
export function MobileTabBar({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);

  // O layout persiste entre navegacoes no App Router — o painel nao
  // desmonta sozinho ao trocar de tela, precisa fechar na mao. Ajustar o
  // estado durante a renderizacao (comparando com a rota anterior guardada
  // em outro estado), em vez de um useEffect, e o padrao recomendado pelo
  // React para "resetar estado quando algo muda" — evita o round-trip extra
  // de um efeito disparando outro render.
  const [pathnameAnterior, setPathnameAnterior] = useState(pathname);
  if (pathname !== pathnameAnterior) {
    setPathnameAnterior(pathname);
    setMaisAberto(false);
  }

  const maisAtivo = MAIS.some((item) => pathname.includes(`/${item.key}`));

  return (
    <>
      {maisAberto && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMaisAberto(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="border-border bg-card absolute inset-x-0 bottom-0 rounded-t-xl border-t p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <ul>
              {MAIS.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href(companyId)}
                    className="text-foreground hover:bg-muted flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5"
                  >
                    <item.icon className="size-5 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <nav
        className="border-border bg-card fixed inset-x-0 bottom-0 z-40 border-t md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex">
          {PRINCIPAIS.map((item) => {
            const ativo = pathname.includes(`/${item.key}`);
            return (
              <li key={item.key} className="min-w-0 flex-1">
                <Link
                  href={item.href(companyId)}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 text-[11px]",
                    ativo ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-5 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMaisAberto((aberto) => !aberto)}
              aria-expanded={maisAberto}
              className={cn(
                "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 py-2 text-[11px]",
                maisAberto || maisAtivo ? "text-primary" : "text-muted-foreground",
              )}
            >
              {maisAberto ? (
                <X className="size-5 shrink-0" aria-hidden />
              ) : (
                <Menu className="size-5 shrink-0" aria-hidden />
              )}
              <span className="truncate">Mais</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
