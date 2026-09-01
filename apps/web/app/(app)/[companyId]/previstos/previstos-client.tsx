"use client";

/**
 * A pagar e a receber. Reaproveita DetalheLancamento (memo/badges/formulario
 * de edicao) e AcoesLancamento (dar baixa/excluir) de /lancamentos — o
 * mesmo componente serve as duas telas porque a linha em si (LancamentoRow)
 * e identica, so o recorte muda (aqui, todo previsto em aberto de qualquer
 * mes; la, os lancamentos de um mes so).
 */

import type { BankAccount, Category, CostCenter, Counterparty } from "@aec/db";
import { daysBetween, fromDb, splitPlanned } from "@aec/domain";
import {
  DataTable,
  type DataTableColumn,
  Money,
  StatTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@aec/ui";
import { useState } from "react";

import { formatDate } from "@/lib/ui/format";

import { AcoesLancamento } from "../lancamentos/acoes-lancamento";
import { DetalheLancamento } from "../lancamentos/detalhe-lancamento";
import type { LancamentoRow } from "../lancamentos/lancamentos-table";

function Bucket({
  titulo,
  itens,
  destacarVencido,
  hoje,
  companyId,
  podeEditar,
  onAbrir,
}: {
  titulo: string;
  itens: readonly LancamentoRow[];
  destacarVencido: boolean;
  hoje: string;
  companyId: string;
  podeEditar: boolean;
  onAbrir: (id: string) => void;
}) {
  if (itens.length === 0) return null;

  const columns: DataTableColumn<LancamentoRow>[] = [
    {
      key: "data",
      header: "Data",
      render: (linha) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDate(linha.booking_date)}
          {destacarVencido && (
            <span className="text-outflow ml-1 text-xs">
              (há {daysBetween(linha.booking_date, hoje)} dia(s))
            </span>
          )}
        </span>
      ),
    },
    {
      key: "descricao",
      header: "Descrição",
      render: (linha) => (
        <button
          type="button"
          onClick={() => onAbrir(linha.id)}
          className="focus-visible:ring-ring/30 rounded text-left outline-none focus-visible:ring-2"
        >
          <p className="font-medium">{linha.description}</p>
          <p className="text-muted-foreground text-xs">{linha.contaNome}</p>
        </button>
      ),
    },
    {
      key: "categoria",
      header: "Categoria",
      render: (linha) =>
        linha.categoriaNome ?? <span className="text-xs italic">sem categoria</span>,
    },
    {
      key: "valor",
      header: "Valor",
      align: "right",
      render: (linha) => <Money cents={fromDb(linha.amount)} />,
    },
    {
      key: "acoes",
      header: "",
      align: "right",
      render: (linha) => (
        <AcoesLancamento companyId={companyId} lancamento={linha} podeEditar={podeEditar} />
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground text-sm font-medium">
        {titulo} ({itens.length})
      </h3>
      <DataTable columns={columns} rows={itens} />
    </div>
  );
}

export function PrevistosClient({
  companyId,
  previstos,
  contas,
  categorias,
  contrapartes,
  centrosDeCusto,
  podeEditar,
  hoje,
}: {
  companyId: string;
  previstos: readonly LancamentoRow[];
  contas: readonly BankAccount[];
  categorias: readonly Category[];
  contrapartes: readonly Counterparty[];
  centrosDeCusto: readonly CostCenter[];
  podeEditar: boolean;
  hoje: string;
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const split = splitPlanned(
    previstos.map((p) => ({ id: p.id, bookingDate: p.booking_date, amount: fromDb(p.amount) })),
    hoje,
  );
  const porId = new Map(previstos.map((p) => [p.id, p]));
  const linhas = (ids: readonly { id: string }[]): LancamentoRow[] =>
    ids.map((entry) => porId.get(entry.id)!);

  const aReceber = { vencidos: linhas(split.overdueIn), aVencer: linhas(split.upcomingIn) };
  const aPagar = { vencidos: linhas(split.overdueOut), aVencer: linhas(split.upcomingOut) };
  const aberto = previstos.find((p) => p.id === abertoId) ?? null;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="pagar">
        <TabsList>
          <TabsTrigger value="pagar">
            A pagar ({aPagar.vencidos.length + aPagar.aVencer.length})
          </TabsTrigger>
          <TabsTrigger value="receber">
            A receber ({aReceber.vencidos.length + aReceber.aVencer.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pagar" className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Vencido"
              value={<Money cents={split.totals.overdueOut} />}
              tone="negative"
            />
            <StatTile label="A vencer" value={<Money cents={split.totals.upcomingOut} />} />
          </div>
          {aPagar.vencidos.length === 0 && aPagar.aVencer.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nada a pagar em aberto.
            </p>
          ) : (
            <>
              <Bucket
                titulo="Vencidos"
                itens={aPagar.vencidos}
                destacarVencido
                hoje={hoje}
                companyId={companyId}
                podeEditar={podeEditar}
                onAbrir={setAbertoId}
              />
              <Bucket
                titulo="A vencer"
                itens={aPagar.aVencer}
                destacarVencido={false}
                hoje={hoje}
                companyId={companyId}
                podeEditar={podeEditar}
                onAbrir={setAbertoId}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="receber" className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Vencido"
              value={<Money cents={split.totals.overdueIn} />}
              tone="positive"
            />
            <StatTile label="A vencer" value={<Money cents={split.totals.upcomingIn} />} />
          </div>
          {aReceber.vencidos.length === 0 && aReceber.aVencer.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nada a receber em aberto.
            </p>
          ) : (
            <>
              <Bucket
                titulo="Vencidos"
                itens={aReceber.vencidos}
                destacarVencido
                hoje={hoje}
                companyId={companyId}
                podeEditar={podeEditar}
                onAbrir={setAbertoId}
              />
              <Bucket
                titulo="A vencer"
                itens={aReceber.aVencer}
                destacarVencido={false}
                hoje={hoje}
                companyId={companyId}
                podeEditar={podeEditar}
                onAbrir={setAbertoId}
              />
            </>
          )}
        </TabsContent>
      </Tabs>

      <DetalheLancamento
        key={abertoId ?? "fechado"}
        companyId={companyId}
        lancamento={aberto}
        podeEditar={podeEditar}
        contas={contas}
        categorias={categorias}
        contrapartes={contrapartes}
        centrosDeCusto={centrosDeCusto}
        open={abertoId !== null}
        onOpenChange={(open) => {
          if (!open) setAbertoId(null);
        }}
      />
    </div>
  );
}
