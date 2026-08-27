/**
 * Server Actions de cadastros: categorias, centros de custo e contrapartes.
 *
 * Regras de matching (matching_rules) tem cadastro proprio em
 * app/(app)/[companyId]/conciliacao/actions.ts — criadas no fluxo de
 * conciliacao, no momento em que a categoria certa esta na tela. Aqui so
 * entra a acao de desativar uma regra, que faz mais sentido junto do resto
 * dos cadastros do que dentro da tela de conciliacao.
 *
 * Como em accounts.ts: nenhuma acao checa o papel explicitamente antes de
 * escrever — a policy de RLS (categories_write/cost_centers_write exigem
 * "contador"; counterparties_write/matching_rules_write exigem "assistente")
 * e a autoridade de verdade. A pagina so mostra o formulario pra quem tem o
 * papel certo, por conveniencia de navegacao.
 */

"use server";

import type { CategoryKind } from "@aec/db";
import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

function traduzErro(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Ja existe um cadastro com esse nome nesta empresa.";
  }
  return error.message;
}

export async function criarCategoria(input: {
  companyId: string;
  name: string;
  kind: CategoryKind;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome da categoria." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("categories").insert({
    company_id: input.companyId,
    name: input.name.trim(),
    kind: input.kind,
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/cadastros`);
  return OK;
}

export async function desativarCategoria(companyId: string, id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("categories")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/cadastros`);
  return OK;
}

export async function criarCentroCusto(input: {
  companyId: string;
  name: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome do centro de custo." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("cost_centers").insert({
    company_id: input.companyId,
    name: input.name.trim(),
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/cadastros`);
  return OK;
}

export async function desativarCentroCusto(companyId: string, id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("cost_centers")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/cadastros`);
  return OK;
}

function normalizeTaxId(value: string | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export async function criarContraparte(input: {
  companyId: string;
  name: string;
  taxId?: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome da contraparte." };

  const taxId = normalizeTaxId(input.taxId);
  if (taxId && taxId.length !== 11 && taxId.length !== 14) {
    return { ok: false, error: "CPF precisa ter 11 digitos e CNPJ 14 (so numeros)." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("counterparties").insert({
    company_id: input.companyId,
    name: input.name.trim(),
    tax_id: taxId,
  });
  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/cadastros`);
  return OK;
}

export async function desativarContraparte(companyId: string, id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("counterparties")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/cadastros`);
  return OK;
}

export async function desativarRegra(companyId: string, id: string): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("matching_rules")
    .update({ is_active: false })
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/cadastros`);
  revalidatePath(`/${companyId}/conciliacao`);
  revalidatePath(`/${companyId}/regras`);
  revalidatePath(`/${companyId}/inicio`);
  return OK;
}
