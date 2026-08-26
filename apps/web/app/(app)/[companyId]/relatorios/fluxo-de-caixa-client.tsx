"use client";

/**
 * Fluxo de caixa: evolucao diaria do saldo, so com o que ja aconteceu
 * (status "realizado") — reaproveita o mesmo project() do dominio que o
 * painel usa para a projecao futura. Passar so entradas realizadas faz o
 * "trazer vencido pra frente" (pensado para previstos em atraso) nunca
 * disparar aqui, exatamente o que se quer num fluxo historico.
 */

import type { ProjectionResult } from "@aec/domain";
import { formatAmount } from "@aec/domain";

import { Alert, Button, Card, CardHeader, EmptyState, Money } from "@/lib/ui/components";
import { formatDate } from "@/lib/ui/format";

export function FluxoDeCaixaClient({
  resultado,
  saldoInicial,
  periodoInvalido,
}: {
  resultado: ProjectionResult;
  saldoInicial: number;
  periodoInvalido: boolean;
}) {
  function exportarCsv() {
    const linhas = [
      ["Data", "Entradas", "Saidas", "Liquido", "Saldo"],
      ...resultado.days.map((dia) => [
        formatDate(dia.date),
        formatAmount(dia.inflow),
        formatAmount(dia.outflow),
        formatAmount(dia.net),
        formatAmount(dia.balance),
      ]),
    ];
    const csv = linhas.map((linha) => linha.join(";")).join("\r\n");
    // BOM na frente: sem ele, o Excel no Windows le acento como lixo quando
    // abre um CSV UTF-8 clicando duas vezes (o caminho real de uso aqui).
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fluxo-de-caixa.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (periodoInvalido) {
    return <Alert tone="error">A data final precisa ser igual ou posterior a data inicial.</Alert>;
  }

  return (
    <Card>
      <CardHeader
        title="Fluxo de caixa"
        action={
          resultado.days.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={exportarCsv}>
              Exportar CSV
            </Button>
          ) : undefined
        }
      />

      {resultado.days.length === 0 ? (
        <EmptyState
          title="Nenhum dia no periodo"
          description="Ajuste as datas para ver a evolucao do saldo."
        />
      ) : (
        <>
          <div className="grid gap-4 border-b p-4 sm:grid-cols-4">
            <Resumo titulo="Saldo inicial" valor={saldoInicial} />
            <Resumo titulo="Entradas" valor={resultado.totalInflow} />
            <Resumo titulo="Saidas" valor={resultado.totalOutflow} />
            <Resumo titulo="Saldo final" valor={resultado.finalBalance} destaque />
          </div>

          {resultado.firstNegativeDate && (
            <div className="px-4 pt-4">
              <Alert tone="error" title="O saldo ficou negativo neste periodo">
                A partir de <strong>{formatDate(resultado.firstNegativeDate)}</strong>, chegando a{" "}
                <Money cents={resultado.lowestBalance} /> em{" "}
                {formatDate(resultado.lowestBalanceDate!)}.
              </Alert>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 text-right font-medium">Entradas</th>
                  <th className="px-4 py-2 text-right font-medium">Saidas</th>
                  <th className="px-4 py-2 text-right font-medium">Liquido</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {resultado.days.map((dia) => (
                  <tr key={dia.date} className={dia.negative ? "bg-outflow/5" : undefined}>
                    <td className="px-4 py-2">{formatDate(dia.date)}</td>
                    <td className="px-4 py-2 text-right">
                      {dia.inflow > 0 ? <Money cents={dia.inflow} /> : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {dia.outflow < 0 ? <Money cents={dia.outflow} /> : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={dia.net} />
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      <Money cents={dia.balance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function Resumo({
  titulo,
  valor,
  destaque,
}: {
  titulo: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{titulo}</p>
      <p className={destaque ? "text-lg font-semibold" : "font-medium"}>
        <Money cents={valor} />
      </p>
    </div>
  );
}
