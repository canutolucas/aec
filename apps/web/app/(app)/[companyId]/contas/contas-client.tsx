"use client";

import { ACCOUNT_KIND_LABELS, type AccountBalance, type BankAccount } from "@aec/db";
import { fromDb, sum } from "@aec/domain";
import { Fragment, useState } from "react";

import {
  Alert,
  Badge,
  BankBadge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Money,
} from "@/lib/ui/components";
import { formatDate } from "@/lib/ui/format";

import { EditarContaForm } from "./editar-conta-form";
import { NovaContaForm } from "./nova-conta-form";

export function ContasClient({
  companyId,
  podeEditar,
  contas,
}: {
  companyId: string;
  podeEditar: boolean;
  contas: readonly { saldo: AccountBalance; bruta: BankAccount }[];
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const totalAtual = sum(contas.map((c) => fromDb(c.saldo.current_balance)));
  const totalProjetado = sum(contas.map((c) => fromDb(c.saldo.projected_balance)));

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th className="px-4 py-2 font-medium">Conta</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">Saldo inicial</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo hoje</th>
                  <th className="px-4 py-2 text-right font-medium">Projetado</th>
                  <th className="px-4 py-2 font-medium">Situacao</th>
                  {podeEditar && <th className="px-4 py-2 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {contas.map(({ saldo, bruta }) => {
                  const atual = fromDb(saldo.current_balance);
                  const minimo = saldo.minimum_balance ? fromDb(saldo.minimum_balance) : null;
                  const pendentes = Number(saldo.unreconciled_count);
                  const emEdicao = editandoId === saldo.bank_account_id;

                  return (
                    <Fragment key={saldo.bank_account_id}>
                      <tr>
                        <td className="px-4 py-2">
                          <p className="font-medium">{saldo.name}</p>
                          {saldo.bank_name && (
                            <p className="text-muted-foreground flex items-center gap-1 text-xs">
                              <BankBadge bankName={saldo.bank_name} />
                              {saldo.bank_name}
                            </p>
                          )}
                        </td>
                        <td className="text-muted-foreground px-4 py-2">
                          {ACCOUNT_KIND_LABELS[saldo.kind]}
                        </td>
                        <td className="text-muted-foreground px-4 py-2 text-xs">
                          <span className="tabular-money">
                            {formatDate(saldo.opening_balance_date)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Money cents={atual} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Money cents={fromDb(saldo.projected_balance)} />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {minimo !== null && atual < minimo && (
                              <Badge tone="warn">abaixo do minimo</Badge>
                            )}
                            {pendentes > 0 && <Badge>{pendentes} a conciliar</Badge>}
                            {!saldo.is_active && <Badge>inativa</Badge>}
                          </div>
                        </td>
                        {podeEditar && (
                          <td className="px-4 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditandoId(emEdicao ? null : saldo.bank_account_id)}
                            >
                              {emEdicao ? "Fechar" : "Editar"}
                            </Button>
                          </td>
                        )}
                      </tr>
                      {emEdicao && (
                        <tr>
                          <td colSpan={podeEditar ? 7 : 6} className="bg-muted/30 p-4">
                            <EditarContaForm
                              companyId={companyId}
                              conta={bruta}
                              onSalvo={() => setEditandoId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
                  {podeEditar && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {podeEditar ? (
        <Card>
          <CardHeader title="Cadastrar conta" />
          <NovaContaForm companyId={companyId} />
        </Card>
      ) : (
        <Alert tone="info">
          Seu perfil nao permite cadastrar ou editar contas bancarias. Peca a quem tem perfil de
          contador ou responsavel.
        </Alert>
      )}
    </div>
  );
}
