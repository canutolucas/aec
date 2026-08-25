import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import {
  type BankAccount,
  type Category,
  hasRole,
  type MonthlyClosing,
  type Transaction,
} from "@/lib/db/types";
import { endOfMonth, startOfMonth, todayInBrazil } from "@/lib/domain/dates";
import { fromDb, sum } from "@/lib/domain/money";
import { Alert, Badge, Card, CardHeader, EmptyState, Money } from "@/lib/ui/components";
import { formatDate, formatMonth } from "@/lib/ui/format";
import { LancamentoRapido } from "./lancamento-rapido";
import { FiltroMes } from "./filtro-mes";
import { LinhaLancamento } from "./linha-lancamento";

export const metadata = { title: "Lancamentos — Controle Bancario" };

export default async function LancamentosPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ mes?: string; conta?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  const session = await requireCompany(companyId);
  const podeLancar = hasRole(session.role, "assistente");

  const hoje = todayInBrazil();
  const mes = filtros.mes ?? startOfMonth(hoje);
  const primeiroDia = startOfMonth(mes);
  const ultimoDia = endOfMonth(mes);

  const supabase = await createServerSupabase();

  const [contasResult, categoriasResult, lancamentosResult, fechamentoResult] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("categories")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("transactions")
      .select("*")
      .eq("company_id", companyId)
      .gte("booking_date", primeiroDia)
      .lte("booking_date", ultimoDia)
      .order("booking_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("monthly_closings")
      .select("*")
      .eq("company_id", companyId)
      .eq("period", primeiroDia)
      .maybeSingle(),
  ]);

  for (const result of [contasResult, categoriasResult, lancamentosResult]) {
    if (result.error) throw result.error;
  }

  const contas = (contasResult.data ?? []) as BankAccount[];
  const categorias = (categoriasResult.data ?? []) as Category[];
  const fechamento = fechamentoResult.data as MonthlyClosing | null;
  const mesFechado = Boolean(fechamento?.locked_at);

  const todos = (lancamentosResult.data ?? []) as Transaction[];
  const lancamentos = filtros.conta
    ? todos.filter((lancamento) => lancamento.bank_account_id === filtros.conta)
    : todos;

  const nomePorConta = new Map(contas.map((conta) => [conta.id, conta.name]));
  const nomePorCategoria = new Map(categorias.map((categoria) => [categoria.id, categoria.name]));

  // Transferencia nao e receita nem despesa: entra no saldo da conta, mas fica
  // fora do total de entradas e saidas do mes.
  const doResultado = lancamentos.filter((lancamento) => !lancamento.is_transfer);
  const entradas = sum(
    doResultado.filter((l) => l.direction === "entrada").map((l) => fromDb(l.amount)),
  );
  const saidas = sum(
    doResultado.filter((l) => l.direction === "saida").map((l) => fromDb(l.amount)),
  );

  return (
    <div className="space-y-6">
      <FiltroMes companyId={companyId} mes={primeiroDia} conta={filtros.conta} contas={contas} />

      {mesFechado && (
        <Alert tone="warn" title={`${formatMonth(primeiroDia)} esta fechado`}>
          Os lancamentos deste mes nao podem ser alterados nem excluidos. Para corrigir algo, reabra
          o fechamento informando o motivo — a reabertura fica registrada.
        </Alert>
      )}

      {podeLancar && !mesFechado && (
        <Card>
          <CardHeader title="Lancar" />
          <LancamentoRapido
            companyId={companyId}
            contas={contas}
            categorias={categorias}
            hoje={hoje >= primeiroDia && hoje <= ultimoDia ? hoje : primeiroDia}
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Lancamentos de ${formatMonth(primeiroDia)}`}
          action={
            <div className="flex items-center gap-4 text-xs">
              <span>
                Entradas <Money cents={entradas} className="ml-1 font-semibold" />
              </span>
              <span>
                Saidas <Money cents={saidas} className="ml-1 font-semibold" />
              </span>
              <span className="text-[--color-tinta-fraca]">
                Resultado{" "}
                <Money cents={entradas + saidas} className="ml-1 font-semibold" />
              </span>
            </div>
          }
        />

        {lancamentos.length === 0 ? (
          <EmptyState
            title="Nenhum lancamento neste mes"
            description={
              podeLancar
                ? "Use o formulario acima para lancar a primeira entrada ou saida do mes."
                : "Ainda nao ha movimento registrado para este periodo."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[--color-borda] text-left text-xs text-[--color-tinta-fraca]">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Descricao</th>
                  <th className="px-4 py-2 font-medium">Conta</th>
                  <th className="px-4 py-2 font-medium">Categoria</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 font-medium">Situacao</th>
                  <th className="w-10 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-borda]">
                {lancamentos.map((lancamento) => (
                  <LinhaLancamento
                    key={lancamento.id}
                    companyId={companyId}
                    lancamento={lancamento}
                    contaNome={nomePorConta.get(lancamento.bank_account_id) ?? "—"}
                    categoriaNome={
                      lancamento.category_id
                        ? (nomePorCategoria.get(lancamento.category_id) ?? "—")
                        : null
                    }
                    podeEditar={podeLancar && !mesFechado}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {categorias.length === 0 && podeLancar && (
        <Alert tone="info" title="Nenhuma categoria cadastrada">
          Da para lancar sem categoria, mas os relatorios gerenciais so ficam uteis quando as
          entradas e saidas estao classificadas.
        </Alert>
      )}
    </div>
  );
}
