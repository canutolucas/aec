/**
 * Server Actions de recorrencias (lancamentos fixos): aluguel, folha,
 * honorarios de clientes, impostos — o que se repete todo mes e nao
 * precisa ser redigitado.
 *
 * A tabela `recurrences`, a RLS (`recurrences_write` exige contador — mesmo
 * padrao de bank_accounts/categories/cost_centers, mexer no plano de contas
 * fixo reescreve projecao futura) e `expandRecurrence()`
 * (packages/domain/src/projection.ts) existem desde a primeira leva de
 * schema e nunca tinham sido ligadas a nenhuma tela.
 */

"use server";

import { type RecurrenceFrequency } from "@aec/db";
import {
  addDays,
  addMonths,
  type Cents,
  compareDates,
  endOfMonth,
  expandRecurrence,
  fromDb,
  MoneyError,
  parseUserInput,
  startOfMonth,
  todayInBrazil,
  toDb,
} from "@aec/domain";
import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

function parseValor(
  amount: string,
  direction: "entrada" | "saida",
): { ok: true; valor: Cents } | { ok: false; error: string } {
  try {
    const valor = Math.abs(parseUserInput(amount));
    if (valor === 0) return { ok: false, error: "O valor precisa ser diferente de zero." };
    return { ok: true, valor: direction === "saida" ? -valor : valor };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof MoneyError
          ? `Valor invalido: ${amount}`
          : "Nao foi possivel entender o valor informado.",
    };
  }
}

export interface RecorrenciaInput {
  companyId: string;
  bankAccountId: string;
  categoryId?: string;
  counterpartyId?: string;
  costCenterId?: string;
  description: string;
  /** Sempre digitado positivo — o sinal vem de `direction`. */
  amount: string;
  direction: "entrada" | "saida";
  frequency: RecurrenceFrequency;
  dayOfMonth?: number;
  startDate: string;
  endDate?: string;
}

export async function criarRecorrencia(input: RecorrenciaInput): Promise<ActionResult> {
  if (!input.description.trim()) return { ok: false, error: "Informe a descricao." };

  const valores = parseValor(input.amount, input.direction);
  if (!valores.ok) return valores;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("recurrences").insert({
    company_id: input.companyId,
    bank_account_id: input.bankAccountId,
    category_id: input.categoryId || null,
    counterparty_id: input.counterpartyId || null,
    cost_center_id: input.costCenterId || null,
    description: input.description.trim(),
    amount: toDb(valores.valor),
    frequency: input.frequency,
    day_of_month: input.dayOfMonth ?? null,
    start_date: input.startDate,
    end_date: input.endDate || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${input.companyId}/recorrencias`);
  return OK;
}

export interface EditarRecorrenciaInput extends RecorrenciaInput {
  id: string;
}

export async function editarRecorrencia(input: EditarRecorrenciaInput): Promise<ActionResult> {
  if (!input.description.trim()) return { ok: false, error: "Informe a descricao." };

  const valores = parseValor(input.amount, input.direction);
  if (!valores.ok) return valores;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("recurrences")
    .update({
      bank_account_id: input.bankAccountId,
      category_id: input.categoryId || null,
      counterparty_id: input.counterpartyId || null,
      cost_center_id: input.costCenterId || null,
      description: input.description.trim(),
      amount: toDb(valores.valor),
      frequency: input.frequency,
      day_of_month: input.dayOfMonth ?? null,
      start_date: input.startDate,
      end_date: input.endDate || null,
    })
    .eq("id", input.id)
    .eq("company_id", input.companyId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // RLS nega UPDATE em silencio: zero linhas afetadas, sem erro — mesmo
  // padrao ja aplicado em cadastros.ts/accounts.ts.
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: recorrencia nao encontrada." };
  }

  revalidatePath(`/${input.companyId}/recorrencias`);
  return OK;
}

export async function definirRecorrenciaAtiva(
  companyId: string,
  id: string,
  ativa: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("recurrences")
    .update({ is_active: ativa })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (data.length === 0) {
    return {
      ok: false,
      error: `Nao foi possivel ${ativa ? "reativar" : "desativar"}: recorrencia nao encontrada.`,
    };
  }

  revalidatePath(`/${companyId}/recorrencias`);
  return OK;
}

export interface GerarPrevistosSummary {
  readonly ok: boolean;
  readonly error?: string;
  readonly criados: number;
  readonly jaExistiam: number;
  readonly falharam: readonly { description: string; bookingDate: string; error: string }[];
}

/**
 * Gera os previstos de toda recorrencia ativa da empresa, ate o fim do mes
 * seguinte. Segue a convencao de auto-aplicacao deste repo: um INSERT
 * independente por ocorrencia, nunca uma transacao envolvente — uma
 * ocorrencia ruim no meio nao pode desfazer o que ja foi criado antes dela.
 * `generated_until` e a guarda normal contra duplicata; a consulta aos
 * `booking_date` ja existentes por `recurrence_id` e a rede de seguranca se
 * a tela for reaberta no meio de uma geracao anterior.
 */
export async function gerarPrevistos(companyId: string): Promise<GerarPrevistosSummary> {
  const supabase = await createServerSupabase();

  const { data: recorrencias, error } = await supabase
    .from("recurrences")
    .select(
      "id, bank_account_id, category_id, counterparty_id, cost_center_id, description, amount, frequency, day_of_month, start_date, end_date, generated_until",
    )
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (error) return { ok: false, error: error.message, criados: 0, jaExistiam: 0, falharam: [] };

  const hoje = todayInBrazil();
  const horizonte = endOfMonth(addMonths(startOfMonth(hoje), 1));

  let criados = 0;
  let jaExistiam = 0;
  const falharam: { description: string; bookingDate: string; error: string }[] = [];

  for (const recorrencia of recorrencias ?? []) {
    // Ainda nao comecou, ou ja foi gerada ate o horizonte — nada a fazer.
    if (compareDates(recorrencia.start_date, horizonte) > 0) continue;
    const de = recorrencia.generated_until
      ? addDays(recorrencia.generated_until, 1)
      : recorrencia.start_date;
    if (compareDates(de, horizonte) > 0) continue;

    const entradas = expandRecurrence(
      {
        startDate: recorrencia.start_date,
        endDate: recorrencia.end_date ?? undefined,
        frequency: recorrencia.frequency,
        dayOfMonth: recorrencia.day_of_month ?? undefined,
        amount: fromDb(recorrencia.amount),
        description: recorrencia.description,
      },
      de,
      horizonte,
    );

    const { data: existentes } = await supabase
      .from("transactions")
      .select("booking_date")
      .eq("recurrence_id", recorrencia.id);
    const datasExistentes = new Set((existentes ?? []).map((t) => t.booking_date));

    for (const entrada of entradas) {
      if (datasExistentes.has(entrada.bookingDate)) {
        jaExistiam++;
        continue;
      }

      const { error: insertError } = await supabase.from("transactions").insert({
        company_id: companyId,
        bank_account_id: recorrencia.bank_account_id,
        category_id: recorrencia.category_id,
        counterparty_id: recorrencia.counterparty_id,
        cost_center_id: recorrencia.cost_center_id,
        booking_date: entrada.bookingDate,
        competence_date: entrada.bookingDate,
        amount: toDb(entrada.amount),
        status: "previsto",
        // expandRecurrence sempre grava spec.description (obrigatorio em
        // RecurrenceSpec); o `?? recorrencia.description` so satisfaz o
        // tipo compartilhado ProjectionEntry, onde description e opcional.
        description: entrada.description ?? recorrencia.description,
        recurrence_id: recorrencia.id,
      });

      if (insertError) {
        falharam.push({
          description: entrada.description ?? recorrencia.description,
          bookingDate: entrada.bookingDate,
          error: insertError.message,
        });
      } else {
        criados++;
      }
    }

    // Avanca generated_until ate o horizonte (ou o fim da recorrencia, se
    // for antes) mesmo sem nenhuma entrada nova — para a proxima chamada
    // nao reescanear o mesmo intervalo.
    const novoGeradoAte =
      recorrencia.end_date && compareDates(recorrencia.end_date, horizonte) < 0
        ? recorrencia.end_date
        : horizonte;
    await supabase
      .from("recurrences")
      .update({ generated_until: novoGeradoAte })
      .eq("id", recorrencia.id);
  }

  revalidatePath(`/${companyId}/recorrencias`);
  revalidatePath(`/${companyId}/previstos`);
  revalidatePath(`/${companyId}/hoje`);

  return { ok: true, criados, jaExistiam, falharam };
}
