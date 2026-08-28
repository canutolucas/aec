/**
 * Server Actions de perfis de contas (lentes gerenciais) — ver
 * supabase/migrations/20250101001800_account_profiles.sql.
 *
 * Ao contrario de accounts.ts/cadastros.ts, aqui a escrita passa por RPC
 * (create_account_profile/set_account_profile_accounts) em vez de INSERT/
 * UPDATE direto: criar um perfil grava DUAS tabelas (o perfil e o vinculo
 * com as contas) e precisa das duas juntas na mesma transacao, senao um
 * perfil sem nenhuma conta ficaria visivel entre uma chamada e outra.
 */

"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

function traduzErro(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Ja existe um perfil com esse nome nesta empresa.";
  }
  return error.message;
}

export async function criarPerfil(
  companyId: string,
  name: string,
  bankAccountIds: string[],
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_account_profile", {
    p_company_id: companyId,
    p_name: name,
    p_bank_account_ids: bankAccountIds,
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${companyId}/contas`);
  return OK;
}

export async function editarContasDoPerfil(
  companyId: string,
  profileId: string,
  bankAccountIds: string[],
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("set_account_profile_accounts", {
    p_profile_id: profileId,
    p_company_id: companyId,
    p_bank_account_ids: bankAccountIds,
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${companyId}/contas`);
  return OK;
}

export async function renomearPerfil(
  companyId: string,
  profileId: string,
  name: string,
): Promise<ActionResult> {
  if (!name.trim()) return { ok: false, error: "Informe o nome do perfil." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("account_profiles")
    .update({ name: name.trim() })
    .eq("id", profileId)
    .eq("company_id", companyId)
    .select("id");
  if (error) return { ok: false, error: traduzErro(error) };

  // RLS nega UPDATE em silencio: zero linhas afetadas, sem erro nenhum — o
  // mesmo caso ja documentado em editarConta (accounts.ts).
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: perfil nao encontrado." };
  }

  revalidatePath(`/${companyId}/contas`);
  return OK;
}

/** Soft delete, no mesmo padrao de desativarCategoria/desativarContraparte. */
export async function arquivarPerfil(companyId: string, profileId: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("account_profiles")
    .update({ is_active: false })
    .eq("id", profileId)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/contas`);
  return OK;
}
