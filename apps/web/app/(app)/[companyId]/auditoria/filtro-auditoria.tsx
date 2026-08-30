"use client";

/**
 * Mesmo padrao de FiltroMes (lancamentos/filtro-mes.tsx) — navegacao por
 * mes — mais um segundo filtro por tabela, exclusivo desta tela.
 */

import { addMonths, startOfMonth } from "@aec/domain";
import { Select } from "@aec/ui";
import { useRouter } from "next/navigation";

import { formatMonth } from "@/lib/ui/format";
import { routes, withQuery } from "@/lib/ui/routes";

export function FiltroAuditoria({
  companyId,
  mes,
  tabela,
  tabelas,
}: {
  companyId: string;
  mes: string;
  tabela?: string;
  tabelas: readonly { value: string; label: string }[];
}) {
  const router = useRouter();

  function navegar(novoMes: string, novaTabela: string | undefined) {
    router.push(withQuery(routes.auditLog(companyId), { mes: novoMes, tabela: novaTabela }));
  }

  const anterior = startOfMonth(addMonths(mes, -1));
  const proximo = startOfMonth(addMonths(mes, 1));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="border-border bg-card flex items-center gap-1 rounded-md border">
        <button
          type="button"
          onClick={() => navegar(anterior, tabela)}
          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="min-w-40 px-2 text-center text-sm font-medium">{formatMonth(mes)}</span>
        <button
          type="button"
          onClick={() => navegar(proximo, tabela)}
          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
          aria-label="Proximo mes"
        >
          ›
        </button>
      </div>

      <Select
        value={tabela ?? ""}
        onChange={(event) => navegar(mes, event.target.value || undefined)}
        className="w-auto"
      >
        <option value="">Todas as tabelas</option>
        {tabelas.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
