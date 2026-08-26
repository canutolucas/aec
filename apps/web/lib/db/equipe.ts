/**
 * Server Actions de integrantes da empresa.
 *
 * `adicionarIntegrante` chama `public.add_member` (RPC) porque nao ha
 * outro jeito de encontrar o id de alguem pelo e-mail antes do vinculo
 * existir — `profiles_select_self` so deixa ver o proprio perfil ou o de
 * quem ja compartilha empresa com voce. `removerIntegrante` e um DELETE
 * direto: memberships_write ja exige papel de owner, e o gatilho
 * `memberships_guard_last_owner` impede que a empresa fique sem ninguem
 * que possa administra-la.
 */

"use server";

import type { MemberRole } from "@aec/db";
import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

export async function adicionarIntegrante(input: {
  companyId: string;
  email: string;
  role: MemberRole;
}): Promise<ActionResult> {
  const email = input.email.trim();
  if (!email) return { ok: false, error: "Informe o e-mail da pessoa." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("add_member", {
    p_company_id: input.companyId,
    p_email: email,
    p_role: input.role,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${input.companyId}/equipe`);
  return OK;
}

export async function removerIntegrante(companyId: string, userId: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("memberships")
    .delete()
    .eq("company_id", companyId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/equipe`);
  return OK;
}

/**
 * Liga/desliga o modo simples de UM integrante — preferencia de navegacao
 * por pessoa+empresa (ver a migration de simple_mode), nunca de permissao:
 * o papel continua sendo a unica coisa que a RLS valida. Um UPDATE direto,
 * nao uma RPC nova: protegido pela mesma policy memberships_write (owner)
 * que ja existe, sem o problema de ovo-e-galinha que add_member resolve
 * (aqui a linha ja existe, so um campo dela muda).
 */
export async function alternarModoSimples(
  companyId: string,
  userId: string,
  simpleMode: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("memberships")
    .update({ simple_mode: simpleMode })
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .select("id");
  if (error) return { ok: false, error: error.message };

  // RLS nega UPDATE em silencio: zero linhas afetadas, sem erro nenhum —
  // o mesmo caso ja documentado em editarConta (accounts.ts) e
  // excluirLancamento (transactions.ts).
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: integrante nao encontrado." };
  }

  revalidatePath(`/${companyId}/equipe`);
  return OK;
}
