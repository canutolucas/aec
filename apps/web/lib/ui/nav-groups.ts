/**
 * Fase 2b da reforma de UI/UX: aposenta o modo simples como duas
 * interfaces separadas. Antes, `simpleMode` trocava a navegação inteira
 * (`simpleNav()` vs `NAV`, em layout.tsx) e `requireAdvancedAccess()`
 * expulsava quem estava em modo simples de 7 das 11 telas do sistema —
 * quem operava a empresa no dia a dia (a persona real: a sogra do dono do
 * projeto) não tinha como abrir Contas, Cadastros ou Regras sem primeiro
 * pedir pra alguém desligar o modo simples nela.
 *
 * Agora existe UMA navegação: 9-11 itens viram 5 grupos (Hoje é o único
 * que não é grupo — as outras quatro têm sub-abas, ver `NAV_GROUPS`
 * abaixo). `simpleMode` deixa de ser um portão de tela e vira só uma
 * preferência de densidade: dentro de Ajustes, esconde a sub-aba
 * Cadastros (categorias/contrapartes/centros de custo — mexe na
 * "engenharia" da contabilidade, não no dia a dia de lançar e conciliar).
 * Contas e Regras continuam sempre visíveis (a pessoa precisa cadastrar
 * conta e desligar uma regra ruim mesmo no modo simples); Equipe continua
 * só para quem tem papel de owner, independente do modo — é a única tela
 * que desliga o modo simples, então precisa continuar alcançável mesmo
 * por quem está nele.
 *
 * Como sempre neste projeto: isto é só navegação. Quem decide o que a
 * pessoa pode LER OU ESCREVER continua sendo `role` + RLS no banco.
 */

import { hasRole, type MemberRole } from "@aec/db";
import type { Route } from "next";

import { routes } from "./routes";

export interface NavGroupItem {
  readonly key: string;
  readonly label: string;
  readonly href: (companyId: string) => Route;
  /** Escondida quando a empresa está em modo simples — "ajuste avançado". */
  readonly hideInSimpleMode?: boolean;
  /** Só aparece para quem tem este papel ou mais (RLS decide o resto). */
  readonly minRole?: MemberRole;
}

export interface NavGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NavGroupItem[];
}

export const NAV_GROUPS = {
  movimentos: {
    key: "movimentos",
    label: "Movimentos",
    items: [
      { key: "inicio", label: "Extrato", href: routes.home },
      { key: "lancamentos", label: "Lançamentos", href: (id: string) => routes.transactions(id) },
      { key: "conciliacao", label: "Conciliação", href: routes.reconciliation },
    ],
  },
  notas: {
    key: "notas",
    label: "Notas",
    items: [
      { key: "faturamento", label: "Faturamento", href: routes.invoices },
      { key: "recebimentos", label: "Recebimentos", href: routes.receivables },
    ],
  },
  relatorios: {
    key: "relatorios",
    label: "Relatórios",
    items: [
      { key: "painel", label: "Painel", href: routes.dashboard },
      { key: "fluxo", label: "Fluxo de caixa", href: routes.reports },
      { key: "categorias", label: "Por categoria", href: routes.categoryReport },
      // RLS so deixa contador+ ler audit_log (ver 20250101000700_rls.sql) — a
      // aba fica escondida de quem nunca conseguiria ver nada nela mesmo.
      { key: "auditoria", label: "Auditoria", href: routes.auditLog, minRole: "contador" as const },
    ],
  },
  ajustes: {
    key: "ajustes",
    label: "Ajustes",
    items: [
      { key: "contas", label: "Contas", href: routes.accounts },
      { key: "cadastros", label: "Cadastros", href: routes.registries, hideInSimpleMode: true },
      { key: "regras", label: "Regras", href: routes.rules },
      { key: "equipe", label: "Equipe", href: routes.team, minRole: "owner" as const },
    ],
  },
} as const satisfies Record<string, NavGroup>;

export type NavGroupKey = keyof typeof NAV_GROUPS;

/** A navegação de topo: Hoje sozinho, depois um item por grupo (leva à primeira aba visível). */
export function topLevelNav(role: MemberRole, simpleMode: boolean) {
  return [
    { key: "hoje", label: "Hoje", href: routes.today },
    ...Object.values(NAV_GROUPS).map((group) => ({
      key: group.key,
      label: group.label,
      href: visibleItems(group, role, simpleMode)[0]!.href,
    })),
  ];
}

/** Itens de um grupo que a pessoa de fato pode ver, dados papel e modo. */
export function visibleItems(
  group: NavGroup,
  role: MemberRole,
  simpleMode: boolean,
): readonly NavGroupItem[] {
  return group.items.filter((item) => {
    if (item.hideInSimpleMode && simpleMode) return false;
    if (item.minRole && !hasRole(role, item.minRole)) return false;
    return true;
  });
}
