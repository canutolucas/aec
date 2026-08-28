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
    if (companies.length === 0) redirect(routes.companies);
    const fallback = companies[0]!;
    redirect(routes.today(fallback.id));
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
 * Ate a Fase 2b da reforma de UI/UX, isto mandava quem estava no modo
 * simples de volta para /inicio — simpleMode produzia duas interfaces
 * inteiras, e 7 das 11 telas do sistema (Contas, Lancamentos, Conciliacao,
 * Relatorios, Cadastros, Equipe, Painel) ficavam inalcancaveis pra quem
 * estava nele. Fase 2b unifica a navegacao (ver
 * apps/web/lib/ui/nav-groups.ts): agora toda tela avancada aparece pra
 * todo mundo, e simpleMode vira so uma preferencia que esconde a aba
 * Cadastros dentro de Ajustes (o unico "ajuste avancado" de verdade —
 * Contas e Regras continuam sempre visiveis, sao operacao do dia a dia).
 *
 * A funcao continua existindo (em vez de trocar as ~7 chamadas por
 * requireCompany direto) so pra marcar, no proprio nome do import de cada
 * pagina, que aquela tela e conceitualmente "avancada" — mas o
 * comportamento e identico a requireCompany hoje. Conveniencia de
 * navegacao, como o resto deste arquivo: quem decide o que a pessoa pode
 * LER OU ESCREVER sempre foi role + RLS, nunca simpleMode.
 */
export async function requireAdvancedAccess(companyId: string): Promise<SessionContext> {
  return requireCompany(companyId);
}
