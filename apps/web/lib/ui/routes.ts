/**
 * Application routes, in one place.
 *
 * Next's `typedRoutes` validates static routes, but can't validate a dynamic
 * route assembled at runtime: `/${string}/painel` doesn't satisfy `SafeSlug`,
 * because an arbitrary string could contain a slash. The alternative would be
 * sprinkling `as Route` across every link in the system.
 *
 * Instead, the cast lives here, once, and the rest of the code calls
 * functions. Besides avoiding repetition, this gives a check the scattered
 * cast wouldn't: there's no way to get the path wrong, because no one writes
 * a path — changing a route means changing this function.
 */

import type { Route } from "next";

export const routes = {
  root: "/" as Route,
  login: "/login" as Route,
  signUp: "/cadastrar" as Route,
  forgotPassword: "/esqueci-senha" as Route,
  resetPassword: "/nova-senha" as Route,
  companies: "/empresas" as Route,

  today: (companyId: string) => `/${companyId}/hoje` as Route,
  reviewQueue: (companyId: string) => `/${companyId}/revisar` as Route,
  dashboard: (companyId: string) => `/${companyId}/painel` as Route,
  home: (companyId: string) => `/${companyId}/inicio` as Route,
  accounts: (companyId: string) => `/${companyId}/contas` as Route,
  registries: (companyId: string) => `/${companyId}/cadastros` as Route,
  team: (companyId: string) => `/${companyId}/equipe` as Route,
  reports: (companyId: string) => `/${companyId}/relatorios` as Route,
  categoryReport: (companyId: string) => `/${companyId}/relatorio-categorias` as Route,
  auditLog: (companyId: string) => `/${companyId}/auditoria` as Route,
  reconciliation: (companyId: string) => `/${companyId}/conciliacao` as Route,
  planned: (companyId: string) => `/${companyId}/previstos` as Route,
  closings: (companyId: string) => `/${companyId}/fechamentos` as Route,
  rules: (companyId: string) => `/${companyId}/regras` as Route,
  recurrences: (companyId: string) => `/${companyId}/recorrencias` as Route,
  invoices: (companyId: string) => `/${companyId}/faturamento` as Route,
  receivables: (companyId: string) => `/${companyId}/recebimentos` as Route,
  transactions: (companyId: string, filters?: { month?: string; account?: string }) => {
    const query = new URLSearchParams();
    if (filters?.month) query.set("mes", filters.month);
    if (filters?.account) query.set("conta", filters.account);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return `/${companyId}/lancamentos${suffix}` as Route;
  },
} as const;

/**
 * Validates the destination stored at login before redirecting.
 *
 * Only accepts an internal path starting with a single slash. Without this, a
 * link like `/login?destino=https://fake-site` would make the system itself
 * throw the person onto a third-party address right after they type their
 * password — the classic open redirect, exactly what phishing relies on.
 */
export function safeDestination(destination: string | undefined): Route {
  if (!destination) return routes.root;
  if (!destination.startsWith("/") || destination.startsWith("//")) return routes.root;
  return destination as Route;
}

/** Appends query parameters to a route, preserving its type. */
export function withQuery(route: Route, params: Record<string, string | undefined>): Route {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  return (query.size > 0 ? `${route}?${query.toString()}` : route) as Route;
}
