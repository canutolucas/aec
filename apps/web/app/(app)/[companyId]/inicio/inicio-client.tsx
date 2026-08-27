"use client";

/**
 * Fluxo simples: entrar, subir o extrato, ter o mes pronto.
 *
 * Depois do arquivo escolhido, o fluxo avanca sozinho — importa e ja tenta
 * organizar tudo (autoApplyReconciliation). So para diante de duas coisas:
 * um problema real no arquivo (integrity.ok === false ou algum warning), ou
 * uma excecao de verdade que sobrou depois da auto-aplicacao (um pareamento
 * so "provavel", ou uma linha sem categoria alguma). Cada excecao se resolve
 * com um botao/selecao so.
 */

import type { Category } from "@aec/db";
import { directionOf, formatBRL, fromDb, suggestRuleText } from "@aec/domain";
import type { CanonicalStatement } from "@aec/statements";
import { Alert, Button, Card, CardHeader, Dropzone, Field, LinkButton, Select } from "@aec/ui";
import { useState, useTransition } from "react";

import { desativarRegra } from "@/lib/db/cadastros";
import { autoApplyReceivables } from "@/lib/db/faturamento";
import { friendlyError } from "@/lib/ui/format";
import { routes } from "@/lib/ui/routes";

import {
  type AutoApplyException,
  type AutoApplyFailure,
  autoApplyReconciliation,
  type AutoApplyResult,
  type AutoApplySuggestion,
  createMatchingRule,
  createTransactionFromLine,
  importStatement,
  reconcileLine,
  undoTransactionFromLine,
} from "../conciliacao/actions";
import { parseStatementFile, statementToImportPayload } from "../conciliacao/parse-file";
import type { InicioAccount } from "./page";

type Phase = "idle" | "confirm-warning" | "processing" | "done";

interface PendingUpload {
  readonly statement: CanonicalStatement;
  readonly fileName: string;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

interface SessionState {
  readonly reconciled: number;
  readonly created: number;
  readonly suggested: readonly AutoApplySuggestion[];
  readonly uncategorized: readonly AutoApplyException[];
  readonly failed: readonly AutoApplyFailure[];
  /**
   * Recebimentos de nota fiscal casados com este mesmo extrato. Null quando
   * a checagem nao rodou ou falhou — nao bloqueia o resto do fluxo, e so um
   * bonus em cima da conciliacao de extrato que ja funcionou.
   */
  readonly receivables: {
    readonly settled: number;
    readonly pending: number;
    readonly failed: number;
  } | null;
}

export function InicioClient({
  companyId,
  accounts,
  categories,
}: {
  companyId: string;
  accounts: readonly InicioAccount[];
  categories: readonly Category[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ text: string; tone: "warn" | "error" } | null>(null);
  /**
   * O ultimo item lancado por launchUncategorized, para poder desfazer com
   * um clique. So o mais recente — nao uma pilha — porque o risco real e o
   * erro de dedo que se percebe na hora, olhando pro item que acabou de
   * sumir da lista, nao um historico de varios passos atras.
   */
  const [lastLaunch, setLastLaunch] = useState<{
    item: AutoApplyException;
    ruleId?: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function applySession(
    result: AutoApplyResult,
    receivables?: { settled: number; pending: number; failed: number } | null,
  ) {
    setSession((prev) => ({
      reconciled: (prev?.reconciled ?? 0) + (result.reconciled ?? 0),
      created: (prev?.created ?? 0) + (result.created ?? 0),
      suggested: result.exceptions?.suggested ?? [],
      uncategorized: result.exceptions?.uncategorized ?? [],
      failed: result.exceptions?.failed ?? [],
      receivables: receivables !== undefined ? receivables : (prev?.receivables ?? null),
    }));
    setPhase("done");
  }

  function proceed(statement: CanonicalStatement, fileName: string) {
    setPending(null);
    setPhase("processing");
    startTransition(async () => {
      const imported = await importStatement({
        companyId,
        bankAccountId: accountId,
        fileName,
        payload: statementToImportPayload(statement),
      });
      if (!imported.ok) {
        setFeedback({
          text: friendlyError(imported.error, "Nao foi possivel importar o extrato."),
          tone: "error",
        });
        setPhase("idle");
        return;
      }

      const applied = await autoApplyReconciliation({ companyId, bankAccountId: accountId });
      if (!applied.ok) {
        setFeedback({
          text: friendlyError(
            applied.error,
            "O extrato foi importado, mas nao foi possivel organizar automaticamente.",
          ),
          tone: "error",
        });
        setPhase("idle");
        return;
      }

      // Bonus depois da conciliacao de extrato: tenta casar os mesmos
      // creditos com notas fiscais em aberto. Uma falha aqui nao desfaz nem
      // bloqueia o que ja funcionou acima — so fica sem o bloco de
      // recebimentos na tela de resultado.
      const receivablesResult = await autoApplyReceivables({ companyId, bankAccountId: accountId });
      const receivables = receivablesResult.ok
        ? {
            settled: receivablesResult.settled ?? 0,
            pending: receivablesResult.suggested?.length ?? 0,
            failed: receivablesResult.failed?.length ?? 0,
          }
        : null;

      applySession(applied, receivables);
    });
  }

  async function handleFile(file: File) {
    setFeedback(null);
    // Tira o Dropzone de tela (so aparece nas fases "idle"/"confirm-warning")
    // assim que o arquivo chega — sem isso, a leitura do arquivo (que pode
    // envolver uma chamada ao servidor para PDF) roda antes de qualquer
    // startTransition, e o Dropzone continuaria clicavel/arrastavel nesse
    // meio-tempo, convidando um segundo arquivo a entrar por cima do primeiro.
    setPhase("processing");

    const parsed = await parseStatementFile(companyId, file);
    if (!parsed.ok) {
      setFeedback({ text: parsed.error, tone: "error" });
      setPhase("idle");
      return;
    }

    const problems =
      parsed.statement.integrity && !parsed.statement.integrity.ok
        ? parsed.statement.integrity.problems
        : [];
    const warnings = parsed.statement.warnings;

    if (problems.length > 0 || warnings.length > 0) {
      setPending({ statement: parsed.statement, fileName: file.name, problems, warnings });
      setPhase("confirm-warning");
      return;
    }

    proceed(parsed.statement, file.name);
  }

  function confirmSuggestion(item: AutoApplySuggestion) {
    startTransition(async () => {
      const result = await reconcileLine({
        companyId,
        statementLineId: item.lineId,
        transactionId: item.transactionId,
      });
      if (!result.ok) {
        setFeedback({
          text: friendlyError(result.error, "Nao foi possivel confirmar."),
          tone: "error",
        });
        return;
      }
      setSession(
        (prev) =>
          prev && {
            ...prev,
            reconciled: prev.reconciled + 1,
            suggested: prev.suggested.filter((s) => s.lineId !== item.lineId),
          },
      );
    });
  }

  function launchUncategorized(item: AutoApplyException) {
    const categoryId = categoryDrafts[item.lineId];
    if (!categoryId) return;
    startTransition(async () => {
      const result = await createTransactionFromLine({
        companyId,
        statementLineId: item.lineId,
        categoryId,
        ruleId: null,
      });
      if (!result.ok) {
        setFeedback({
          text: friendlyError(result.error, "Nao foi possivel lancar."),
          tone: "error",
        });
        return;
      }

      // Aprende com a escolha. Sem isto, a MESMA linha recorrente (aluguel,
      // assinatura, folha) voltaria a pedir categoria todo mes, para
      // sempre — exatamente o "trabalho manual" que o fluxo simples
      // promete eliminar. A tela avancada oferece isto como uma caixinha
      // opcional ("Salvar como regra"); aqui, onde a premissa e zero
      // decisao extra, a regra e criada direto — se a pessoa escolheu essa
      // categoria uma vez, aplicar de novo na proxima linha parecida e a
      // automacao que ela pediu, nao uma decisao nova.
      let ruleWarning = "";
      let ruleId: string | undefined;
      const matchText = suggestRuleText(item.memo);
      if (matchText) {
        const ruleResult = await createMatchingRule({
          companyId,
          matchText,
          categoryId,
          bankAccountId: accountId,
          direction: directionOf(item.amount),
        });
        // O lancamento ja foi criado nesse ponto — uma regra que falhou ao
        // salvar nao desfaz isso, so significa que a proxima linha parecida
        // vai pedir categoria de novo (mesmo comportamento da tela avancada).
        if (!ruleResult.ok) {
          ruleWarning = ` A regra nao foi salva: ${ruleResult.error ?? "erro desconhecido"}.`;
        } else {
          ruleId = ruleResult.ruleId;
        }
      }
      if (ruleWarning) setFeedback({ text: `Lancamento criado.${ruleWarning}`, tone: "warn" });

      setLastLaunch({ item, ruleId });
      setSession(
        (prev) =>
          prev && {
            ...prev,
            created: prev.created + 1,
            uncategorized: prev.uncategorized.filter((u) => u.lineId !== item.lineId),
          },
      );
    });
  }

  /**
   * Desfaz o ultimo lancamento criado pelo fluxo simples — e a regra
   * aprendida junto, se alguma foi criada, para uma categoria escolhida
   * errado nao continuar se aplicando sozinha nos proximos meses. A linha
   * volta para "Escolher categoria", como se nunca tivesse sido lancada.
   */
  function undoLastLaunch() {
    if (!lastLaunch) return;
    const { item, ruleId } = lastLaunch;
    startTransition(async () => {
      const result = await undoTransactionFromLine({ companyId, statementLineId: item.lineId });
      if (!result.ok) {
        setFeedback({
          text: friendlyError(result.error, "Nao foi possivel desfazer este lancamento."),
          tone: "error",
        });
        return;
      }

      let ruleWarning = "";
      if (ruleId) {
        const ruleResult = await desativarRegra(companyId, ruleId);
        if (!ruleResult.ok) {
          ruleWarning = ` A regra criada continua ativa: ${ruleResult.error ?? "erro desconhecido"}.`;
        }
      }

      setFeedback(
        ruleWarning ? { text: `Lancamento desfeito.${ruleWarning}`, tone: "warn" } : null,
      );
      setLastLaunch(null);
      setSession(
        (prev) =>
          prev && {
            ...prev,
            created: prev.created - 1,
            uncategorized: [item, ...prev.uncategorized],
          },
      );
    });
  }

  function retryFailed() {
    startTransition(async () => {
      const applied = await autoApplyReconciliation({ companyId, bankAccountId: accountId });
      if (!applied.ok) {
        setFeedback({
          text: friendlyError(applied.error, "Nao foi possivel tentar de novo."),
          tone: "error",
        });
        return;
      }
      applySession(applied);
    });
  }

  function uploadAnother() {
    setPhase("idle");
    setSession(null);
    setPending(null);
    setFeedback(null);
    setCategoryDrafts({});
    setLastLaunch(null);
  }

  const allClear =
    session !== null &&
    session.suggested.length === 0 &&
    session.uncategorized.length === 0 &&
    session.failed.length === 0;

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      {(phase === "idle" || phase === "confirm-warning") && (
        <Card>
          <CardHeader title="Subir extrato" />
          <div className="space-y-4 p-4">
            {accounts.length > 1 && (
              <Field label="Conta bancaria">
                <Select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  disabled={isPending}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.bank_name ? ` — ${account.bank_name}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {phase === "idle" ? (
              <Dropzone
                accept=".ofx,.qfx,.csv,.pdf"
                disabled={isPending || !accountId}
                onFiles={(files) => {
                  const file = files[0];
                  if (file) void handleFile(file);
                }}
                hint="OFX, QFX, CSV ou PDF do Cora"
              />
            ) : (
              pending && (
                <div className="space-y-3">
                  <Alert tone="warn">{[...pending.problems, ...pending.warnings].join(" ")}</Alert>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => proceed(pending.statement, pending.fileName)}
                    >
                      Continuar mesmo assim
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => {
                        setPending(null);
                        setPhase("idle");
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )
            )}
          </div>
        </Card>
      )}

      {phase === "processing" && (
        <Card>
          <div className="text-muted-foreground p-8 text-center text-sm">
            Organizando o mes automaticamente...
          </div>
        </Card>
      )}

      {phase === "done" && session && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Resumo" />
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              <Resumo label="Lancamentos criados" value={session.created} />
              <Resumo label="Pareamentos confirmados" value={session.reconciled} />
              <Resumo
                label="Pendencias"
                value={
                  session.suggested.length + session.uncategorized.length + session.failed.length
                }
              />
            </div>
          </Card>

          {lastLaunch && (
            <Alert tone="info">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Lancamento criado: {lastLaunch.item.memo || "Movimento sem historico"} ·{" "}
                  {formatBRL(fromDb(lastLaunch.item.amount))}
                </span>
                <Button size="sm" variant="ghost" disabled={isPending} onClick={undoLastLaunch}>
                  Desfazer
                </Button>
              </div>
            </Alert>
          )}

          {session.receivables && (
            <Card>
              <CardHeader title="Recebimentos de notas fiscais" />
              <div className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
                <p className="text-sm">
                  <span className="font-semibold">{session.receivables.settled}</span>{" "}
                  recebimento(s) confirmado(s) automaticamente
                  {session.receivables.pending > 0 && (
                    <>
                      {" "}
                      · <span className="font-semibold">{session.receivables.pending}</span>{" "}
                      aguardando confirmacao
                    </>
                  )}
                  .
                </p>
                {session.receivables.pending > 0 && (
                  <LinkButton href={routes.receivables(companyId)} size="sm">
                    Ver em Recebimentos
                  </LinkButton>
                )}
              </div>
              {session.receivables.failed > 0 && (
                <div className="border-border border-t p-4">
                  <p className="text-sm">
                    <span className="text-destructive font-semibold">
                      {session.receivables.failed}
                    </span>{" "}
                    não pôde(pôderam) ser aplicado(s) automaticamente.{" "}
                    <a
                      href={routes.receivables(companyId)}
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      Ver detalhe em Recebimentos
                    </a>
                  </p>
                </div>
              )}
            </Card>
          )}

          {allClear ? (
            <Alert tone="success">Tudo conciliado. O mes esta pronto.</Alert>
          ) : (
            <>
              {session.suggested.length > 0 && (
                <Card>
                  <CardHeader title={`Confirmar pareamento (${session.suggested.length})`} />
                  <div className="divide-border divide-y">
                    {session.suggested.map((item) => (
                      <div
                        key={item.lineId}
                        className="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center"
                      >
                        <div>
                          <p className="text-sm">
                            {item.memo || "Movimento sem historico"} ·{" "}
                            {formatBRL(fromDb(item.amount))}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Provavel correspondencia: {item.transactionDescription}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={isPending}
                          onClick={() => confirmSuggestion(item)}
                        >
                          Confirmar
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {session.uncategorized.length > 0 && (
                <Card>
                  <CardHeader title={`Escolher categoria (${session.uncategorized.length})`} />
                  <div className="divide-border divide-y">
                    {session.uncategorized.map((item) => (
                      <div
                        key={item.lineId}
                        className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-end"
                      >
                        <div>
                          <p className="text-sm">{item.memo || "Movimento sem historico"}</p>
                          <p className="text-muted-foreground text-xs">
                            {item.postedAt} · {formatBRL(fromDb(item.amount))}
                          </p>
                        </div>
                        <Field label="Categoria">
                          <Select
                            value={categoryDrafts[item.lineId] ?? ""}
                            disabled={isPending}
                            onChange={(event) =>
                              setCategoryDrafts((prev) => ({
                                ...prev,
                                [item.lineId]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Escolha...</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Button
                          size="sm"
                          disabled={isPending || !categoryDrafts[item.lineId]}
                          onClick={() => launchUncategorized(item)}
                        >
                          Lancar
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {session.failed.length > 0 && (
                <Card>
                  <CardHeader title={`Nao processado (${session.failed.length})`} />
                  <div className="divide-border divide-y">
                    {session.failed.map((item) => (
                      <div key={item.lineId} className="p-4">
                        <p className="text-sm">{item.memo || "Movimento sem historico"}</p>
                        <p className="text-muted-foreground text-xs">{item.error}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-border border-t p-4">
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={retryFailed}>
                      Tentar de novo
                    </Button>
                  </div>
                </Card>
              )}
            </>
          )}

          <Button variant="ghost" disabled={isPending} onClick={uploadAnother}>
            Subir outro extrato
          </Button>
        </div>
      )}
    </div>
  );
}

function Resumo({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}
