import { redirect } from "next/navigation";

import { listCompanies } from "@/lib/db/session";
import { routes } from "@/lib/ui/routes";

/**
 * Leva direto para a empresa quando so ha uma — o caso do MVP.
 *
 * "Hoje" e a aterrissagem pra qualquer papel e qualquer modo — antes desta
 * leva, modo simples caia em /inicio e modo avancado em /painel, duas telas
 * com vocabulario e layout diferentes pra responder a mesma pergunta ("o
 * que eu faco agora"). Ver CLAUDE.md, secao "Hoje".
 */
export default async function Home() {
  const companies = await listCompanies();

  if (companies.length === 0) redirect(routes.companies);

  const company = companies[0]!;
  redirect(routes.today(company.id));
}
