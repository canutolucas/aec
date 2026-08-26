import { type BankAccount, type Transaction } from "@aec/db";
import {
  addDays,
  type Cents,
  compareDates,
  fromDb,
  isIsoDate,
  project,
  startOfMonth,
  sum,
  todayInBrazil,
} from "@aec/domain";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { FiltroPeriodo } from "./filtro-periodo";
import { FluxoDeCaixaClient } from "./fluxo-de-caixa-client";

export const metadata = { title: "Relatorios — Controle Bancario" };

export default async function RelatoriosPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ de?: string; ate?: string; conta?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  await requireCompany(companyId);

  const hoje = todayInBrazil();
  // Um valor invalido na URL (digitado a mao, um bookmark velho) nao pode
  // derrubar a pagina: addDays/project chamam parseIsoDate, que lanca em
  // qualquer coisa fora do formato — cai no fallback do mesmo jeito que uma
  // data ausente.
  const de = filtros.de && isIsoDate(filtros.de) ? filtros.de : startOfMonth(hoje);
  const ate = filtros.ate && isIsoDate(filtros.ate) ? filtros.ate : hoje;

  const supabase = await createServerSupabase();

  const { data: contasData, error: contasError } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  if (contasError) throw contasError;
  const contas = (contasData ?? []) as BankAccount[];

  const contasEmEscopo = filtros.conta ? contas.filter((c) => c.id === filtros.conta) : contas;

  // Saldo inicial: soma o quanto cada conta ja tinha ANTES do periodo. Traz
  // so a coluna amount (nao a linha inteira: sem descricao, categoria,
  // dedup key etc.) dos lancamentos anteriores ao periodo — um relatorio de
  // um mes nao precisa do peso de anos de historico so para descartar o
  // resultado da soma. PostgREST tambem oferece um sum() agregado no proprio
  // banco, mais leve ainda, mas ele volta como number (json), nao como a
  // string que number->Cents espera em todo outro lugar deste app
  // especificamente para nunca deixar dinheiro passar por ponto flutuante —
  // preferir a soma em JS via fromDb(), mesmo custando mais linhas
  // transferidas, do que abrir essa excecao.
  const diaAnterior = addDays(de, -1);
  const saldoInicial = sum(
    await Promise.all(
      contasEmEscopo.map(async (conta): Promise<Cents> => {
        const { data, error } = await supabase
          .from("transactions")
          .select("amount")
          .eq("company_id", companyId)
          .eq("bank_account_id", conta.id)
          .eq("status", "realizado")
          .lte("booking_date", diaAnterior);
        if (error) throw error;
        const movimento = sum((data ?? []).map((t) => fromDb(t.amount)));
        return fromDb(conta.opening_balance) + movimento;
      }),
    ),
  );

  let transacoes: Transaction[] = [];
  if (contasEmEscopo.length > 0) {
    const { data: transacoesData, error: transacoesError } = await supabase
      .from("transactions")
      .select("*")
      .eq("company_id", companyId)
      .in(
        "bank_account_id",
        contasEmEscopo.map((c) => c.id),
      )
      .eq("status", "realizado")
      .gte("booking_date", de)
      .lte("booking_date", ate)
      .order("booking_date");
    if (transacoesError) throw transacoesError;
    transacoes = (transacoesData ?? []) as Transaction[];
  }

  // Entradas do projeto: as contas em escopo somadas — uma transferencia entre
  // duas contas EM ESCOPO se cancela sozinha (mesmo movimento, sinais opostos),
  // exatamente o comportamento certo para um fluxo de caixa consolidado. Ao
  // filtrar uma unica conta, a transferencia aparece normalmente, como
  // entrada ou saida daquela conta.
  const resultado = project({
    openingBalance: saldoInicial,
    from: de,
    to: ate,
    entries: transacoes.map((t) => ({
      id: t.id,
      bookingDate: t.booking_date,
      amount: fromDb(t.amount),
      status: t.status,
      description: t.description,
    })),
  });

  return (
    <div className="space-y-6">
      <FiltroPeriodo
        companyId={companyId}
        de={de}
        ate={ate}
        conta={filtros.conta}
        contas={contas}
      />
      <FluxoDeCaixaClient
        resultado={resultado}
        saldoInicial={saldoInicial}
        periodoInvalido={compareDates(de, ate) > 0}
      />
    </div>
  );
}
