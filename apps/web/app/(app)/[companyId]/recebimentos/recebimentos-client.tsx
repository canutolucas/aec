"use client";

/**
 * Concilia recebimentos: casa creditos do extrato (de QUALQUER conta) com
 * notas fiscais em aberto. `autoApplyReceivables` ja da baixa nos casos
 * "exact" — ou seja, escreve no banco. Por isso a checagem espera um clique
 * explicito (botao "Buscar e organizar") em vez de rodar sozinha ao abrir a
 * tela: uma contadora com decadas de pratica espera que o sistema pergunte
 * antes de mexer em dado financeiro, nao que decida por conta propria. O
 * que sobra depois vira sugestao de um clique — inclusive o caso de PIX
 * agrupado quitando varias notas de uma vez, que aqui mostra a divisao
 * calculada pronta.
 */

import { formatBRL } from "@aec/domain";
import { Alert, Button, Card, CardHeader, EmptyState } from "@aec/ui";
import { HandCoins } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  autoApplyReceivables,
  type AutoApplyReceivablesFailure,
  type AutoApplyReceivablesSuggestion,
  settleInvoicesAction,
} from "@/lib/db/faturamento";
import { formatDateTime } from "@/lib/ui/format";

import { BaixasDaNota } from "../faturamento/baixas-da-nota";
import type { NotaComBaixas, RecebimentosAccount } from "./page";

export function RecebimentosClient({
  companyId,
  accounts,
  notasComBaixas,
  podeDesfazer,
}: {
  companyId: string;
  accounts: readonly RecebimentosAccount[];
  notasComBaixas: readonly NotaComBaixas[];
  podeDesfazer: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [settledTotal, setSettledTotal] = useState(0);
  const [suggestions, setSuggestions] = useState<readonly AutoApplyReceivablesSuggestion[]>([]);
  const [failed, setFailed] = useState<readonly AutoApplyReceivablesFailure[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; tone: "warn" | "error" } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [verBaixasId, setVerBaixasId] = useState<string | null>(null);

  function runAutoApply() {
    startTransition(async () => {
      setStatus("loading");
      setFeedback(null);

      let settled = 0;
      const allSuggestions: AutoApplyReceivablesSuggestion[] = [];
      const allFailed: AutoApplyReceivablesFailure[] = [];
      const errors: string[] = [];

      for (const account of accounts) {
        const result = await autoApplyReceivables({ companyId, bankAccountId: account.id });
        if (!result.ok) {
          errors.push(`${account.name}: ${result.error ?? "erro desconhecido"}`);
          continue;
        }
        settled += result.settled ?? 0;
        allSuggestions.push(...(result.suggested ?? []));
        allFailed.push(...(result.failed ?? []));
      }

      setSettledTotal(settled);
      setSuggestions(allSuggestions);
      setFailed(allFailed);
      if (errors.length > 0) setFeedback({ text: errors.join(" "), tone: "error" });
      setStatus("done");
      if (settled > 0) router.refresh();
    });
  }

  function confirmar(suggestion: AutoApplyReceivablesSuggestion) {
    startTransition(async () => {
      const result = await settleInvoicesAction({
        companyId,
        transactionId: suggestion.transactionId,
        allocations: suggestion.allocations.map((a) => ({
          invoiceId: a.invoiceId,
          amount: a.amount,
        })),
      });
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Não foi possível dar baixa.", tone: "error" });
        return;
      }
      setSuggestions((prev) => prev.filter((s) => s.transactionId !== suggestion.transactionId));
      setSettledTotal((prev) => prev + 1);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      {status === "idle" ? (
        <Card>
          <CardHeader title="Recebimentos" />
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <HandCoins className="text-muted-foreground size-8" aria-hidden />
            <p className="text-sm">
              Procura créditos no extrato que batem com notas fiscais em aberto e já dá baixa nos
              casos exatos.
            </p>
            <Button loading={isPending} onClick={runAutoApply}>
              Buscar e organizar recebimentos
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Resumo"
            action={
              <Button size="sm" variant="ghost" loading={isPending} onClick={runAutoApply}>
                Atualizar
              </Button>
            }
          />
          <div className="p-4">
            {status === "loading" ? (
              <p className="text-muted-foreground text-sm">
                Procurando créditos e notas em aberto...
              </p>
            ) : (
              <p className="text-sm">
                <span className="font-semibold">{settledTotal}</span> recebimento(s) confirmado(s)
                automaticamente nesta checagem.
              </p>
            )}
          </div>
        </Card>
      )}

      {status === "done" && (
        <Card>
          <CardHeader title={`Para confirmar (${suggestions.length})`} />
          {suggestions.length === 0 ? (
            <EmptyState
              title="Nada pendente"
              description="Todo crédito com nota em aberto correspondente já foi conciliado."
            />
          ) : (
            <div className="divide-border divide-y">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.transactionId}
                  className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {suggestion.transactionDescription || "Movimento sem histórico"} ·{" "}
                      {formatBRL(suggestion.creditAmount)}
                    </p>
                    <p className="text-muted-foreground text-xs">{suggestion.reason}</p>
                    <p className="text-muted-foreground text-xs">
                      {suggestion.allocations
                        .map((a) => `${a.invoiceNumber}: ${formatBRL(a.amount)}`)
                        .join(" + ")}
                    </p>
                  </div>
                  <Button size="sm" disabled={isPending} onClick={() => confirmar(suggestion)}>
                    Confirmar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {status === "done" && failed.length > 0 && (
        <Card>
          <CardHeader title={`Não processado (${failed.length})`} />
          <div className="divide-border divide-y">
            {failed.map((item) => (
              <div key={item.transactionId} className="p-4">
                <p className="text-sm">
                  {item.transactionDescription || "Movimento sem histórico"} ·{" "}
                  {formatBRL(item.creditAmount)}
                  {item.invoiceNumber ? ` → nota ${item.invoiceNumber}` : ""}
                </p>
                <p className="text-muted-foreground text-xs">{item.error}</p>
              </div>
            ))}
          </div>
          <div className="border-border border-t p-4">
            <Button size="sm" variant="ghost" disabled={isPending} onClick={runAutoApply}>
              Tentar de novo
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Baixas registradas (${notasComBaixas.length})`} />
        {notasComBaixas.length === 0 ? (
          <EmptyState
            title="Nenhuma baixa ainda"
            description="As notas quitadas por um crédito do extrato aparecem aqui, com opção de desfazer."
          />
        ) : (
          <div className="divide-border divide-y">
            {notasComBaixas.map((nota) => (
              <div
                key={nota.invoiceId}
                className="flex items-center justify-between gap-3 p-4 text-sm"
              >
                <div>
                  <p className="font-medium">Nota {nota.invoiceNumber}</p>
                  <p className="text-muted-foreground text-xs">
                    {nota.baixas.length} baixa(s) · última em {formatDateTime(nota.ultimaBaixaEm)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setVerBaixasId(nota.invoiceId)}
                  className="text-primary text-xs underline-offset-2 hover:underline"
                >
                  Ver baixas
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {verBaixasId &&
        (() => {
          const nota = notasComBaixas.find((n) => n.invoiceId === verBaixasId);
          return (
            <BaixasDaNota
              companyId={companyId}
              invoiceNumber={nota?.invoiceNumber ?? ""}
              baixas={nota?.baixas ?? []}
              podeDesfazer={podeDesfazer}
              open={verBaixasId !== null}
              onOpenChange={(open) => !open && setVerBaixasId(null)}
            />
          );
        })()}
    </div>
  );
}
