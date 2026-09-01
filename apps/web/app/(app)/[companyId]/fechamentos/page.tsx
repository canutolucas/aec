import { hasRole } from "@aec/db";
import { addMonths, startOfMonth, todayInBrazil } from "@aec/domain";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Badge, Card } from "@/lib/ui/components";
import { formatDateTime, formatMonth } from "@/lib/ui/format";

import { FechamentoMes } from "../lancamentos/fechamento-mes";
import { SubNav } from "../sub-nav";

export const metadata = { title: "Fechamentos — Controle Bancario" };

const MESES_NA_LISTA = 12;

interface LinhaFechamento {
  readonly period: string;
  readonly lockedAt: string | null;
  readonly lockedByName: string | null;
  readonly reopenedAt: string | null;
  readonly reopenedByName: string | null;
  readonly reopenReason: string | null;
  readonly notes: string | null;
}

/**
 * Calendario dos ultimos 12 meses de fechamento — antes desta leva,
 * `monthly_closings` so era consultado um mes por vez (em /painel,
 * /lancamentos e /hoje). Nao havia como responder "eu fechei maio?" sem
 * navegar mes a mes; para quem fecha 12 meses por ano vezes N empresas na
 * carteira, isso e o painel de controle que faltava.
 */
export default async function FechamentosPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireAdvancedAccess(companyId);
  const supabase = await createServerSupabase();

  const inicioDoMes = startOfMonth(todayInBrazil());
  const periodos = Array.from({ length: MESES_NA_LISTA }, (_, i) =>
    addMonths(inicioDoMes, -(MESES_NA_LISTA - 1) + i),
  );

  const { data, error } = await supabase
    .from("monthly_closings")
    .select("period, locked_at, locked_by, reopened_at, reopened_by, reopen_reason, notes")
    .eq("company_id", companyId)
    .in("period", periodos);
  if (error) throw error;

  const idsAutores = [
    ...new Set((data ?? []).flatMap((row) => [row.locked_by, row.reopened_by].filter(Boolean))),
  ] as string[];
  const perfisResult =
    idsAutores.length > 0
      ? await supabase.from("profiles").select("id, full_name, email").in("id", idsAutores)
      : { data: [] };
  const nomePorAutor = new Map(
    (perfisResult.data ?? []).map((perfil) => [perfil.id, perfil.full_name ?? perfil.email ?? "—"]),
  );

  const porPeriodo = new Map((data ?? []).map((row) => [row.period, row]));

  const linhas: LinhaFechamento[] = periodos.map((period) => {
    const row = porPeriodo.get(period);
    return {
      period,
      lockedAt: row?.locked_at ?? null,
      lockedByName: row?.locked_by ? (nomePorAutor.get(row.locked_by) ?? "—") : null,
      reopenedAt: row?.reopened_at ?? null,
      reopenedByName: row?.reopened_by ? (nomePorAutor.get(row.reopened_by) ?? "—") : null,
      reopenReason: row?.reopen_reason ?? null,
      notes: row?.notes ?? null,
    };
  });

  const canClose = hasRole(session.role, "contador");

  return (
    <div className="space-y-6">
      <SubNav group="movimentos" active="fechamentos" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Fechamentos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Os últimos {MESES_NA_LISTA} meses — quando cada um foi fechado, por quem, e se foi
          reaberto.
        </p>
      </div>

      <div className="space-y-3">
        {[...linhas].reverse().map((linha) => (
          <LinhaCalendario
            key={linha.period}
            companyId={companyId}
            linha={linha}
            canClose={canClose}
          />
        ))}
      </div>
    </div>
  );
}

function LinhaCalendario({
  companyId,
  linha,
  canClose,
}: {
  companyId: string;
  linha: LinhaFechamento;
  canClose: boolean;
}) {
  const isClosed = Boolean(linha.lockedAt);
  const wasReopened = Boolean(linha.reopenedAt);

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="font-medium">{formatMonth(linha.period)}</p>
            {isClosed ? (
              <Badge tone="success">fechado</Badge>
            ) : wasReopened ? (
              <Badge tone="warn">reaberto</Badge>
            ) : (
              <Badge>aberto</Badge>
            )}
          </div>
        </div>

        {isClosed && (
          <p className="text-muted-foreground text-xs">
            Fechado em {formatDateTime(linha.lockedAt!)}
            {linha.lockedByName && ` por ${linha.lockedByName}`}
            {linha.notes && ` · ${linha.notes}`}
          </p>
        )}

        {wasReopened && !isClosed && (
          <p className="text-muted-foreground text-xs">
            Reaberto em {formatDateTime(linha.reopenedAt!)}
            {linha.reopenedByName && ` por ${linha.reopenedByName}`}
            {linha.reopenReason && ` · motivo: ${linha.reopenReason}`}
          </p>
        )}

        {canClose && (
          <FechamentoMes
            companyId={companyId}
            period={linha.period}
            monthLabel={formatMonth(linha.period)}
            isClosed={isClosed}
            canClose={canClose}
          />
        )}
      </div>
    </Card>
  );
}
