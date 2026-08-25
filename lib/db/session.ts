/**
 * Sessao e empresa selecionada.
 */

import { redirect } from "next/navigation";
import { createServerSupabase } from "./supabase";
import type { Company, MemberRole } from "./types";
import { rotas } from "@/lib/ui/rotas";

export interface SessionContext {
  readonly userId: string;
  readonly email: string;
  readonly company: Company;
  readonly role: MemberRole;
  readonly companies: ReadonlyArray<Company & { role: MemberRole }>;
}

export async function getUser() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Empresas em que a pessoa tem vinculo, com o papel em cada uma. */
export async function listCompanies(): Promise<Array<Company & { role: MemberRole }>> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("memberships")
    .select("role, companies (id, name, legal_name, tax_id, timezone, is_active)")
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? [])
    .flatMap((row) => {
      const company = row.companies as unknown as Company | null;
      return company ? [{ ...company, role: row.role as MemberRole }] : [];
    })
    .filter((company) => company.is_active);
}

/**
 * Contexto da pagina, ja validado.
 *
 * Redireciona quando nao ha sessao ou quando a empresa da URL nao e uma em que a
 * pessoa tem vinculo. Vale reparar que isto e conveniencia de navegacao, nao
 * seguranca: mesmo que alguem chegasse a uma pagina de outra empresa, o RLS
 * devolveria zero linhas. A protecao esta no banco.
 */
export async function requireCompany(companyId: string): Promise<SessionContext> {
  const user = await getUser();
  if (!user) redirect(rotas.login);

  const companies = await listCompanies();
  const company = companies.find((candidate) => candidate.id === companyId);

  if (!company) {
    redirect(companies.length > 0 ? rotas.painel(companies[0]!.id) : rotas.empresas);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    company,
    role: company.role,
    companies,
  };
}
