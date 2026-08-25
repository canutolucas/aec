import { ACCOUNT_KIND_LABELS, type AccountBalance, hasRole } from "@aec/db";
import { fromDb, sum } from "@aec/domain";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert, Badge, Card, CardHeader, EmptyState, Money } from "@/lib/ui/components";
import { formatDate } from "@/lib/ui/format";

import { NovaContaForm } from "./nova-conta-form";

export const metadata = { title: "Contas — Controle Bancario" };

export default async function ContasPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const podeEditar = hasRole(session.role, "contador");

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("v_account_balances")
    .select("*")
    .eq("company_id", companyId)
    .order("name");

  if (error) throw error;
  const contas = (data ?? []) as AccountBalance[];

  const totalAtual = sum(contas.map((conta) => fromDb(conta.current_balance)));
  const totalProjetado = sum(contas.map((conta) => fromDb(conta.projected_balance)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Contas bancarias" />

        {contas.length === 0 ? (
          <EmptyState
            title="Nenhuma conta cadastrada"
            description="Cadastre cada conta com o saldo do dia em que voce vai parar de usar a planilha. Esse saldo e o ponto de partida: dali em diante o sistema calcula tudo a partir dos lancamentos."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">Conta</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Saldo inicial</th>
                <th className="px-4 py-2 text-right font-medium">Saldo hoje</th>
                <th className="px-4 py-2 text-right font-medium">Projetado</th>
                <th className="px-4 py-2 font-medium">Situacao</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {contas.map((conta) => {
                const saldo = fromDb(conta.current_balance);
                const minimo = conta.minimum_balance ? fromDb(conta.minimum_balance) : null;
                const pendentes = Number(conta.unreconciled_count);

                return (
                  <tr key={conta.bank_account_id}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{conta.name}</p>
                      {conta.bank_name && (
                        <p className="text-muted-foreground text-xs">{conta.bank_name}</p>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-2">
                      {ACCOUNT_KIND_LABELS[conta.kind]}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      <span className="tabular-money">
                        {formatDate(conta.opening_balance_date)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={saldo} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={fromDb(conta.projected_balance)} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {minimo !== null && saldo < minimo && (
                          <Badge tone="warn">abaixo do minimo</Badge>
                        )}
                        {pendentes > 0 && <Badge>{pendentes} a conciliar</Badge>}
                        {!conta.is_active && <Badge>inativa</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-border border-t-2 font-semibold">
                <td className="px-4 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2 text-right">
                  <Money cents={totalAtual} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money cents={totalProjetado} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {podeEditar ? (
        <Card>
          <CardHeader title="Cadastrar conta" />
          <NovaContaForm companyId={companyId} />
        </Card>
      ) : (
        <Alert tone="info">
          Seu perfil ({session.role}) nao permite cadastrar contas bancarias. Peca a quem tem perfil
          de contador ou responsavel.
        </Alert>
      )}
    </div>
  );
}
