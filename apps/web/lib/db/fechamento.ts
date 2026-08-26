/**
 * Server Actions de fechamento mensal.
 *
 * `close_month`/`reopen_month` (supabase/migrations/20250101000600_views_operacoes.sql)
 * ja existiam desde a fase de fechamento do schema, mas nunca tinham sido
 * chamadas de lugar nenhum — a tela sabia mostrar "mes fechado" (lendo
 * `monthly_closings` direto), mas nao existia como fechar ou reabrir um mes
 * por fora do banco. As duas funcoes sao SECURITY INVOKER (o padrao — nenhuma
 * das duas marca `security definer`), entao a policy `monthly_closings_write`
 * (exige papel "contador") e a autoridade de verdade aqui tambem.
 */

"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

// Unlike transactions.ts's traduzErro (where 42501 almost always means "the
// month is already closed"), here it means the opposite: the person's own
// role isn't contador. requireCompany's own gating on this page already
// hides the button for anyone else, so this only fires if the role changed
// mid-session or the action is invoked outside that gated UI.
function traduzErro(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "Seu perfil nao pode fechar ou reabrir o mes — essa acao exige o papel de contador.";
  }
  return error.message;
}

export async function fecharMes(input: {
  companyId: string;
  period: string;
  notes?: string;
}): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("close_month", {
    p_company_id: input.companyId,
    p_period: input.period,
    p_notes: input.notes?.trim() || null,
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}

export async function reabrirMes(input: {
  companyId: string;
  period: string;
  reason: string;
}): Promise<ActionResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Informe o motivo da reabertura." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("reopen_month", {
    p_company_id: input.companyId,
    p_period: input.period,
    p_reason: reason,
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}
