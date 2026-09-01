"use client";

/**
 * Mesmo padrao de FiltroMes (lancamentos/filtro-mes.tsx), so que navega
 * pra routes.categoryReport em vez de routes.transactions — os dois nao
 * compartilham componente porque cada um navega pra uma rota diferente e
 * FiltroMes nao aceita rota como parametro.
 */

import { addMonths, startOfMonth } from "@aec/domain";
import { useRouter } from "next/navigation";

import { formatMonth } from "@/lib/ui/format";
import { routes, withQuery } from "@/lib/ui/routes";

export function FiltroMesCategoria({
  companyId,
  mes,
  regime,
}: {
  companyId: string;
  mes: string;
  regime?: string;
}) {
  const router = useRouter();

  function navegar(novoMes: string) {
    router.push(withQuery(routes.categoryReport(companyId), { mes: novoMes, regime }));
  }

  const anterior = startOfMonth(addMonths(mes, -1));
  const proximo = startOfMonth(addMonths(mes, 1));

  return (
    <div className="border-border bg-card flex w-fit items-center gap-1 rounded-md border">
      <button
        type="button"
        onClick={() => navegar(anterior)}
        className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
        aria-label="Mes anterior"
      >
        ‹
      </button>
      <span className="min-w-40 px-2 text-center text-sm font-medium">{formatMonth(mes)}</span>
      <button
        type="button"
        onClick={() => navegar(proximo)}
        className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
        aria-label="Proximo mes"
      >
        ›
      </button>
    </div>
  );
}
