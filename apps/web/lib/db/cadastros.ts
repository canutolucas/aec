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

/**
 * Restringir o sentido (kind) de uma categoria ja usada no sentido oposto nao
 * dispara trigger nenhum: transactions_check_category so roda ao inserir ou
 * atualizar a PROPRIA transaction, nunca quando a categoria muda por baixo
 * dela. Sem esta contagem, um "ambos" -> "entrada" numa categoria ja usada em
 * saidas deixaria lancamentos existentes silenciosamente inconsistentes com o
 * cadastro (nenhum erro, so um relatorio que nao bate mais).
 */
async function contarLancamentosNoSentidoOposto(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  categoryId: string,
  kind: CategoryKind,
): Promise<number> {
  if (kind === "ambos") return 0;
  const sentidoOposto = kind === "entrada" ? "saida" : "entrada";
  const { count, error } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("category_id", categoryId)
    .eq("direction", sentidoOposto);
  if (error) throw error;
  return count ?? 0;
}

export async function editarCategoria(input: {
  companyId: string;
  id: string;
  name: string;
  kind: CategoryKind;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome da categoria." };

  const supabase = await createServerSupabase();

  let emUsoNoSentidoOposto: number;
  try {
    emUsoNoSentidoOposto = await contarLancamentosNoSentidoOposto(
      supabase,
      input.companyId,
      input.id,
      input.kind,
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro ao validar." };
  }
  if (emUsoNoSentidoOposto > 0) {
    const sentido = input.kind === "entrada" ? "saida" : "entrada";
    return {
      ok: false,
      error: `${emUsoNoSentidoOposto} lancamento(s) de ${sentido} ja usam esta categoria — nao da pra restringi-la a ${input.kind === "entrada" ? "entradas" : "saidas"}.`,
    };
  }

  const { data, error } = await supabase
    .from("categories")
    .update({ name: input.name.trim(), kind: input.kind })
    .eq("id", input.id)
    .eq("company_id", input.companyId)
    .select("id");
  if (error) return { ok: false, error: traduzErro(error) };

  // RLS nega UPDATE em silencio: zero linhas afetadas, sem erro — mesmo
  // padrao ja documentado em excluirLancamento/editarConta.
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: categoria nao encontrada." };
  }

  revalidatePath(`/${input.companyId}/cadastros`);
  return OK;
}

export async function definirCategoriaAtiva(
  companyId: string,
  id: string,
  ativa: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("categories")
    .update({ is_active: ativa })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (data.length === 0) {
    return {
      ok: false,
      error: `Nao foi possivel ${ativa ? "reativar" : "desativar"}: categoria nao encontrada.`,
    };
  }

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

export async function editarCentroCusto(input: {
  companyId: string;
  id: string;
  name: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome do centro de custo." };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("cost_centers")
    .update({ name: input.name.trim() })
    .eq("id", input.id)
    .eq("company_id", input.companyId)
    .select("id");
  if (error) return { ok: false, error: traduzErro(error) };
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: centro de custo nao encontrado." };
  }

  revalidatePath(`/${input.companyId}/cadastros`);
  return OK;
}

export async function definirCentroCustoAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("cost_centers")
    .update({ is_active: ativo })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (data.length === 0) {
    return {
      ok: false,
      error: `Nao foi possivel ${ativo ? "reativar" : "desativar"}: centro de custo nao encontrado.`,
    };
  }

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

export async function editarContraparte(input: {
  companyId: string;
  id: string;
  name: string;
  taxId?: string;
}): Promise<ActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Informe o nome da contraparte." };

  const taxId = normalizeTaxId(input.taxId);
  if (taxId && taxId.length !== 11 && taxId.length !== 14) {
    return { ok: false, error: "CPF precisa ter 11 digitos e CNPJ 14 (so numeros)." };
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("counterparties")
    .update({ name: input.name.trim(), tax_id: taxId })
    .eq("id", input.id)
    .eq("company_id", input.companyId)
    .select("id");
  if (error) return { ok: false, error: traduzErro(error) };
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: contraparte nao encontrada." };
  }

  revalidatePath(`/${input.companyId}/cadastros`);
  return OK;
}

export async function definirContraparteAtiva(
  companyId: string,
  id: string,
  ativa: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("counterparties")
    .update({ is_active: ativa })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (data.length === 0) {
    return {
      ok: false,
      error: `Nao foi possivel ${ativa ? "reativar" : "desativar"}: contraparte nao encontrada.`,
    };
  }

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
