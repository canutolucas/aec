import { redirect } from "next/navigation";
import { listCompanies } from "@/lib/db/session";
import { rotas } from "@/lib/ui/rotas";

/** Leva direto para a empresa quando so ha uma — o caso do MVP. */
export default async function Home() {
  const companies = await listCompanies();

  if (companies.length === 0) redirect(rotas.empresas);
  redirect(rotas.painel(companies[0]!.id));
}
