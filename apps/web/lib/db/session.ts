/**
 * Sessao e empresa selecionada.
 */

import type { Company, MemberRole } from "@aec/db";
import { redirect } from "next/navigation";

import { routes } from "@/lib/ui/routes";

import { createServerSupabase } from "./supabase";

export interface SessionContext {
  readonly userId: string;
  readonly email: string;
  readonly company: Company;
  readonly role: MemberRole;
  /**
   * Preferencia de navegacao da PESSOA nesta empresa (memberships.simple_mode)
   * — nao e seguranca, e so troca qual casca de interface aparece. Quem
   * decide o que a pessoa pode escrever continua sendo `role` + RLS.
   */
  readonly simpleMode: boolean;
  readonly companies: ReadonlyArray<Company & { role: MemberRole; simpleMode: boolean }>;
}

export async function getUser() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Empresas em que a pessoa tem vinculo, com o papel e o modo de navegacao em cada uma. */
export async function listCompanies(): Promise<
  Array<Company & { role: MemberRole; simpleMode: boolean }>
> {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createServerSupabase();

  // O filtro por user_id nao e so uma otimizacao: sem ele, a policy de RLS
  // (que so exige ser membro da MESMA empresa, nao dono da linha) devolve
  // um membership por PESSOA na empresa, nao um por empresa. Numa empresa
  // com dono e assistente, a consulta sem esse filtro traria as duas
  // linhas, e o `.find()` em requireCompany() poderia pegar o papel do
  // OUTRO membro em vez do proprio — confundindo assistente com owner ou
  // o contrario na hora de decidir o que a interface mostra.
  const { data, error } = await supabase
    .from("memberships")
    .select("role, simple_mode, companies (*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? [])
    .flatMap((row) =>
      row.companies ? [{ ...row.companies, role: row.role, simpleMode: row.simple_mode }] : [],
    )
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
  if (!user) redirect(routes.login);

  const companies = await listCompanies();
  const company = companies.find((candidate) => candidate.id === companyId);

  if (!company) {
    redirect(companies.length > 0 ? routes.dashboard(companies[0]!.id) : routes.companies);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    company,
    role: company.role,
    simpleMode: company.simpleMode,
    companies,
  };
}

/**
 * Igual a requireCompany, mas manda quem esta no modo simples de volta para
 * /inicio — usado no topo de toda pagina que so faz sentido no fluxo
 * avancado (Contas, Lancamentos, Conciliacao, Relatorios, Cadastros, Equipe,
 * Painel). Conveniencia de navegacao, como o resto deste arquivo: quem
 * decide o que a pessoa pode LER OU ESCREVER continua sendo role + RLS,
 * nao simpleMode.
 */
export async function requireAdvancedAccess(companyId: string): Promise<SessionContext> {
  const session = await requireCompany(companyId);
  if (session.simpleMode) redirect(routes.home(companyId));
  return session;
}
