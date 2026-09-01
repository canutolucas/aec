"use client";

/**
 * A esteira trabalha no mes que workingMonth() (packages/domain) escolheu —
 * em 1o de setembro, e agosto — mas a contadora continua no controle: pode
 * navegar para qualquer outro mes (`?mes=`), e volta pro automatico com um
 * clique. Mesmo padrao de prev/next de FiltroAuditoria (auditoria/filtro-
 * auditoria.tsx), so que sobre a rota /hoje.
 */

import { addMonths } from "@aec/domain";
import { useRouter } from "next/navigation";

import { formatMonth } from "@/lib/ui/format";
import { routes, withQuery } from "@/lib/ui/routes";

export function MesDeTrabalho({
  companyId,
  periodo,
  emAutomatico,
}: {
  companyId: string;
  periodo: string;
  emAutomatico: boolean;
}) {
  const router = useRouter();

  function navegar(mes: string) {
    router.push(withQuery(routes.today(companyId), { mes }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <div className="border-border bg-card flex items-center gap-1 rounded-md border">
        <button
          type="button"
          onClick={() => navegar(addMonths(periodo, -1))}
          className="text-muted-foreground hover:text-foreground px-2 py-1"
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <span className="min-w-36 px-1 text-center font-medium">
          Trabalhando em {formatMonth(periodo)}
        </span>
        <button
          type="button"
          onClick={() => navegar(addMonths(periodo, 1))}
          className="text-muted-foreground hover:text-foreground px-2 py-1"
          aria-label="Próximo mês"
        >
          ›
        </button>
      </div>
      {!emAutomatico && (
        <button
          type="button"
          onClick={() => router.push(routes.today(companyId))}
          className="text-primary underline-offset-2 hover:underline"
        >
          voltar ao mês de trabalho
        </button>
      )}
    </div>
  );
}
