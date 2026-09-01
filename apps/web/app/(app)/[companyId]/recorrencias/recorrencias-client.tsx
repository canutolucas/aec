"use client";

/**
 * Lancamentos fixos (recorrencias): aluguel, folha, honorarios de clientes,
 * impostos — o que se repete todo mes. "Gerar previstos" e um clique
 * explicito (mesmo principio que autoApplyReceivables em /recebimentos
 * ja aplica: nada escreve no banco sozinho ao abrir a tela).
 */

import {
  type BankAccount,
  type Category,
  type CostCenter,
  type Counterparty,
  type Recurrence,
  RECURRENCE_FREQUENCY_LABELS,
} from "@aec/db";
import { fromDb } from "@aec/domain";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Money } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  definirRecorrenciaAtiva,
  gerarPrevistos,
  type GerarPrevistosSummary,
} from "@/lib/db/recorrencias";
import { formatDate } from "@/lib/ui/format";
import { routes, withQuery } from "@/lib/ui/routes";

import { RecorrenciaForm } from "./recorrencia-form";

export function RecorrenciasClient({
  companyId,
  recorrencias,
  contas,
  categorias,
  contrapartes,
  centrosDeCusto,
  mostrarInativas,
  canEdit,
}: {
  companyId: string;
  recorrencias: readonly Recurrence[];
  contas: readonly BankAccount[];
  categorias: readonly Category[];
  contrapartes: readonly Counterparty[];
  centrosDeCusto: readonly CostCenter[];
  mostrarInativas: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: "success" | "error" } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [gerando, iniciarGeracao] = useTransition();
  const [resultadoGeracao, setResultadoGeracao] = useState<GerarPrevistosSummary | null>(null);

  function alternarAtiva(recorrencia: Recurrence) {
    startTransition(async () => {
      const resultado = await definirRecorrenciaAtiva(
        companyId,
        recorrencia.id,
        !recorrencia.is_active,
      );
      setFeedback(
        resultado.ok
          ? {
              text: `"${recorrencia.description}" ${recorrencia.is_active ? "desativada" : "reativada"}.`,
              tone: "success",
            }
          : { text: resultado.error ?? "Nao foi possivel completar a acao.", tone: "error" },
      );
      if (resultado.ok) router.refresh();
    });
  }

  function gerar() {
    setResultadoGeracao(null);
    iniciarGeracao(async () => {
      const resultado = await gerarPrevistos(companyId);
      if (!resultado.ok) {
        setFeedback({ text: resultado.error ?? "Nao foi possivel gerar.", tone: "error" });
        return;
      }
      setResultadoGeracao(resultado);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      {canEdit && (
        <Card>
          <CardHeader
            title="Gerar previstos"
            action={
              <Button size="sm" onClick={gerar} disabled={gerando}>
                {gerando ? "Gerando..." : "Gerar previstos agora"}
              </Button>
            }
          />
          <div className="space-y-2 p-4 text-sm">
            <p className="text-muted-foreground">
              Cria os lançamentos previstos de cada recorrência ativa até o fim do mês seguinte.
              Pode rodar quantas vezes quiser — o que já foi gerado não se repete.
            </p>
            {resultadoGeracao && (
              <div className="space-y-1">
                <p>
                  <strong>{resultadoGeracao.criados}</strong> previsto(s) criado(s)
                  {resultadoGeracao.jaExistiam > 0 &&
                    `, ${resultadoGeracao.jaExistiam} já existiam`}
                  .
                </p>
                {resultadoGeracao.falharam.length > 0 && (
                  <div className="text-destructive">
                    <p>{resultadoGeracao.falharam.length} falharam:</p>
                    <ul className="list-disc pl-5">
                      {resultadoGeracao.falharam.map((f, i) => (
                        <li key={i}>
                          {f.description} ({formatDate(f.bookingDate)}): {f.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <CardHeader title={`Recorrências (${recorrencias.length})`} />
          <Button
            size="sm"
            variant="ghost"
            className="mr-4"
            onClick={() =>
              router.push(
                withQuery(routes.recurrences(companyId), {
                  inativos: mostrarInativas ? undefined : "1",
                }),
              )
            }
          >
            {mostrarInativas ? "Ocultar inativas" : "Ver inativas"}
          </Button>
        </div>

        {recorrencias.length === 0 ? (
          <EmptyState
            title="Nenhuma recorrência cadastrada"
            description="Aluguel, folha, honorários de clientes e impostos que se repetem todo mês entram aqui — o sistema gera o previsto sozinho."
          />
        ) : (
          <div className="divide-border divide-y">
            {recorrencias.map((recorrencia) => {
              const conta = contas.find((c) => c.id === recorrencia.bank_account_id);
              const emEdicao = editandoId === recorrencia.id;
              return (
                <div
                  key={recorrencia.id}
                  className={recorrencia.is_active ? undefined : "opacity-60"}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{recorrencia.description}</span>
                      <Money cents={fromDb(recorrencia.amount)} />
                      <span className="text-muted-foreground text-xs">
                        {conta?.name ?? "conta removida"} ·{" "}
                        {RECURRENCE_FREQUENCY_LABELS[recorrencia.frequency]}
                        {recorrencia.day_of_month && ` · dia ${recorrencia.day_of_month}`}
                      </span>
                      {!recorrencia.is_active && <Badge>inativa</Badge>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        {recorrencia.is_active && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isPending}
                            onClick={() => setEditandoId(emEdicao ? null : recorrencia.id)}
                          >
                            {emEdicao ? "Fechar" : "Editar"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => alternarAtiva(recorrencia)}
                        >
                          {recorrencia.is_active ? "Desativar" : "Reativar"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {emEdicao && (
                    <div className="bg-muted/30 px-4 pb-4">
                      <RecorrenciaForm
                        companyId={companyId}
                        contas={contas}
                        categorias={categorias}
                        contrapartes={contrapartes}
                        centrosDeCusto={centrosDeCusto}
                        recorrencia={recorrencia}
                        onSalvo={() => {
                          setEditandoId(null);
                          router.refresh();
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {canEdit && (
        <Card>
          <CardHeader title="Cadastrar recorrência" />
          {contas.length === 0 ? (
            <Alert tone="warn">Cadastre uma conta bancária primeiro.</Alert>
          ) : (
            <RecorrenciaForm
              companyId={companyId}
              contas={contas}
              categorias={categorias}
              contrapartes={contrapartes}
              centrosDeCusto={centrosDeCusto}
              onSalvo={() => router.refresh()}
            />
          )}
        </Card>
      )}
    </div>
  );
}
