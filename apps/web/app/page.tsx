import { redirect } from "next/navigation";

import { listCompanies } from "@/lib/db/session";
import { routes } from "@/lib/ui/routes";

/** Leva direto para a empresa quando so ha uma — o caso do MVP. */
export default async function Home() {
  const companies = await listCompanies();

  if (companies.length === 0) redirect(routes.companies);

  const company = companies[0]!;
  redirect(company.simpleMode ? routes.home(company.id) : routes.dashboard(company.id));
}
