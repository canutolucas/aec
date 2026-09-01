"use client";

/**
 * Faturamento: importa o XML de cada nota fiscal e mostra a situacao de
 * recebimento de cada uma. O casamento do recebimento em si (qual credito
 * do extrato quita qual nota) acontece em /recebimentos — aqui e so
 * lancar a nota e acompanhar o que esta em aberto.
 */

import { INVOICE_STATUS_LABELS, type InvoiceBalance } from "@aec/db";
import { fromDb } from "@aec/domain";
import { decodeInvoiceXml } from "@aec/statements";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  ConfirmDialog,
  Dropzone,
  EmptyState,
  Money,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelarNota, importarNotas } from "@/lib/db/faturamento";
import { formatDate, formatTaxId, friendlyError, isInvoiceOverdue } from "@/lib/ui/format";

import { type BaixaDaNota, BaixasDaNota } from "./baixas-da-nota";

const STATUS_TONE: Record<InvoiceBalance["status"], "neutral" | "warn" | "success"> = {
  aberta: "neutral",
  recebida_parcial: "warn",
  recebida: "success",
  cancelada: "neutral",
};

/**
 * Le os bytes brutos (nao .text(), que sempre decodifica como UTF-8) e
 * decodifica respeitando o encoding declarado no proprio XML — o arquivo
 * real de Salvador/BA vem em ISO-8859-1, e nome de cliente com acento
 * vira mojibake se lido como UTF-8 direto.
 */
async function readAsText(file: File): Promise<string> {
  return decodeInvoiceXml(await file.arrayBuffer());
}

export function FaturamentoClient({
  companyId,
  podeImportar,
  invoices,
  baixasPorNota,
}: {
  companyId: string;
  podeImportar: boolean;
  invoices: readonly InvoiceBalance[];
  baixasPorNota: ReadonlyMap<string, readonly BaixaDaNota[]>;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "success" | "warn" | "error";
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [cancelandoId, setCancelandoId] = useState<string | null>(null);
  const [verBaixasId, setVerBaixasId] = useState<string | null>(null);

  function cancelar(invoiceId: string) {
    startTransition(async () => {
      const result = await cancelarNota(companyId, invoiceId);
      setFeedback(
        result.ok
          ? { text: "Nota cancelada.", tone: "success" }
          : { text: result.error ?? "Nao foi possivel cancelar a nota.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  function handleFiles(files: readonly File[]) {
    setFeedback(null);
    startTransition(async () => {
      const parsed = await Promise.all(
        files.map(async (file) => ({ fileName: file.name, xml: await readAsText(file) })),
      );
      const result = await importarNotas({ companyId, files: parsed });

      if (!result.ok) {
        setFeedback({
          text: friendlyError(result.error, "Nao foi possivel importar as notas."),
          tone: "error",
        });
        return;
      }

      const parts: string[] = [];
      if (result.imported) parts.push(`${result.imported} nota(s) importada(s)`);
      if (result.duplicated) parts.push(`${result.duplicated} ja existiam (ignoradas)`);
      if (result.failed && result.failed.length > 0) {
        const details = result.failed
          .map((f) => `${f.fileName} (${friendlyError(f.error, "erro desconhecido")})`)
          .join("; ");
        parts.push(`${result.failed.length} arquivo(s)/nota(s) com erro: ${details}`);
      }

      setFeedback({
        text: parts.join(", ") || "Nenhuma nota nova para importar.",
        tone: result.failed && result.failed.length > 0 ? "warn" : "success",
      });
      router.refresh();
    });
  }

  const totalFaturado = invoices.reduce((sum, inv) => sum + fromDb(inv.amount), 0);
  const totalRecebido = invoices.reduce((sum, inv) => sum + fromDb(inv.received_amount), 0);
  const totalEmAberto = invoices.reduce((sum, inv) => sum + fromDb(inv.outstanding_amount), 0);
  const vencidas = invoices.filter((inv) =>
    isInvoiceOverdue(inv.issued_on, fromDb(inv.outstanding_amount)),
  ).length;

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      {podeImportar && (
        <Card>
          <CardHeader title="Importar notas" />
          <div className="p-4">
            <Dropzone
              accept=".xml"
              multiple
              disabled={isPending}
              onFiles={handleFiles}
              label="Arraste os XMLs das notas aqui, ou clique para escolher"
              hint="Um XML por nota, ou o lote inteiro do periodo exportado pela prefeitura — os dois funcionam."
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Resumo" />
        <div className="grid gap-4 p-4 sm:grid-cols-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              <Money cents={totalFaturado} />
            </p>
            <p className="text-muted-foreground text-xs">Total faturado</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              <Money cents={totalRecebido} />
            </p>
            <p className="text-muted-foreground text-xs">Total recebido</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              <Money cents={totalEmAberto} />
            </p>
            <p className="text-muted-foreground text-xs">Em aberto</p>
          </div>
          <div>
            <p
              className={`text-2xl font-semibold tabular-nums ${vencidas > 0 ? "text-destructive" : ""}`}
            >
              {vencidas}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-muted-foreground w-fit cursor-help text-xs underline decoration-dotted">
                  Vencidas (+45 dias)
                </p>
              </TooltipTrigger>
              <TooltipContent>
                A nota fiscal não declara vencimento — 45 dias é uma folga além do mês seguinte (o
                prazo que a maioria dos clientes paga), pra não marcar como vencida uma nota que
                ainda está dentro do normal.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={`Notas (${invoices.length})`} />
        {invoices.length === 0 ? (
          <EmptyState
            title="Nenhuma nota importada ainda"
            description="Arraste os XMLs das notas fiscais emitidas para comecar a acompanhar o faturamento."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th className="px-4 py-2 font-medium">Nota</th>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Emissao</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-right font-medium">Em aberto</th>
                  <th className="px-4 py-2 font-medium">Situacao</th>
                  {podeImportar && <th className="px-4 py-2 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {invoices.map((invoice) => (
                  <tr key={invoice.invoice_id}>
                    <td className="px-4 py-2">
                      {invoice.number}
                      {invoice.series && (
                        <span className="text-muted-foreground"> / {invoice.series}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <p>{invoice.client_name}</p>
                      {invoice.client_tax_id && (
                        <p className="text-muted-foreground text-xs">
                          {formatTaxId(invoice.client_tax_id)}
                        </p>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      <span className="tabular-money">{formatDate(invoice.issued_on)}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={fromDb(invoice.amount)} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={fromDb(invoice.outstanding_amount)} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[invoice.status]}>
                          {INVOICE_STATUS_LABELS[invoice.status]}
                        </Badge>
                        {isInvoiceOverdue(
                          invoice.issued_on,
                          fromDb(invoice.outstanding_amount),
                        ) && <Badge tone="error">Vencida</Badge>}
                      </div>
                    </td>
                    {podeImportar && (
                      <td className="px-4 py-2 text-right">
                        {fromDb(invoice.received_amount) > 0 ? (
                          <button
                            type="button"
                            onClick={() => setVerBaixasId(invoice.invoice_id)}
                            className="text-primary text-xs underline-offset-2 hover:underline"
                          >
                            Ver baixas
                          </button>
                        ) : (
                          invoice.status !== "cancelada" && (
                            <button
                              type="button"
                              onClick={() => setCancelandoId(invoice.invoice_id)}
                              className="text-muted-foreground hover:text-destructive text-xs underline-offset-2 hover:underline"
                            >
                              Cancelar
                            </button>
                          )
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ConfirmDialog
          open={cancelandoId !== null}
          onOpenChange={(open) => !open && setCancelandoId(null)}
          title="Cancelar esta nota?"
          description="A nota sai da lista de abertas e não entra mais nos totais de faturamento. Isso não pode ser desfeito — use só quando a nota não deveria ter sido importada."
          confirmLabel="Cancelar nota"
          tone="danger"
          onConfirm={() => {
            if (cancelandoId) cancelar(cancelandoId);
          }}
        />

        {verBaixasId && (
          <BaixasDaNota
            companyId={companyId}
            invoiceNumber={invoices.find((i) => i.invoice_id === verBaixasId)?.number ?? ""}
            baixas={baixasPorNota.get(verBaixasId) ?? []}
            podeDesfazer={podeImportar}
            open={verBaixasId !== null}
            onOpenChange={(open) => !open && setVerBaixasId(null)}
          />
        )}
      </Card>
    </div>
  );
}
