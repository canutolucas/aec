"use client";

/**
 * Fecha ou reabre o mes exibido na tela.
 *
 * So renderiza para quem tem papel de contador — a mesma exigencia que
 * `monthly_closings_write` ja aplica no banco; esta checagem e so
 * conveniencia de navegacao, nao a garantia de verdade.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { fecharMes, reabrirMes } from "@/lib/db/fechamento";
import { Alert, Button, Card, CardHeader, Field, Textarea } from "@/lib/ui/components";

export function FechamentoMes({
  companyId,
  period,
  monthLabel,
  isClosed,
  canClose,
}: {
  companyId: string;
  period: string;
  monthLabel: string;
  isClosed: boolean;
  canClose: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; tone: "success" | "error" } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  if (!canClose) return null;

  function fechar() {
    startTransition(async () => {
      const result = await fecharMes({ companyId, period, notes });
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Nao foi possivel fechar o mes.", tone: "error" });
        return;
      }
      setExpanded(false);
      setNotes("");
      setFeedback(null);
      router.refresh();
    });
  }

  function reabrir() {
    if (!reason.trim()) {
      setFeedback({ text: "Informe o motivo da reabertura.", tone: "error" });
      return;
    }
    startTransition(async () => {
      const result = await reabrirMes({ companyId, period, reason });
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Nao foi possivel reabrir o mes.", tone: "error" });
        return;
      }
      setExpanded(false);
      setReason("");
      setFeedback(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title={isClosed ? "Reabertura do mes" : "Fechamento do mes"} />
      <div className="space-y-3 p-4">
        {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

        {!expanded && (
          <Button
            variant={isClosed ? "ghost" : "primary"}
            size="sm"
            onClick={() => setExpanded(true)}
            disabled={isPending}
          >
            {isClosed ? "Reabrir mes" : `Fechar ${monthLabel}`}
          </Button>
        )}

        {expanded && !isClosed && (
          <>
            <p className="text-muted-foreground text-sm">
              Grava o saldo de cada conta neste momento e trava lancamentos deste mes contra
              alteracao ou exclusao. Pode ser reaberto depois, sempre com motivo registrado.
            </p>
            <Field label="Observacoes (opcional)">
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex.: saldo conferido com o extrato em 05/04"
                disabled={isPending}
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={fechar} disabled={isPending}>
                {isPending ? "Fechando..." : `Confirmar fechamento de ${monthLabel}`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
            </div>
          </>
        )}

        {expanded && isClosed && (
          <>
            <Field label="Motivo da reabertura">
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: lancamento duplicado encontrado apos o fechamento"
                disabled={isPending}
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={reabrir} disabled={isPending}>
                {isPending ? "Reabrindo..." : "Confirmar reabertura"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
