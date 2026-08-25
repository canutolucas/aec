"use client";

import type { BankAccount } from "@aec/db";
import { addMonths, startOfMonth } from "@aec/domain";
import { useRouter } from "next/navigation";

import { Select } from "@/lib/ui/components";
import { formatMonth } from "@/lib/ui/format";
import { routes } from "@/lib/ui/routes";

export function FiltroMes({
  companyId,
  mes,
  conta,
  contas,
}: {
  companyId: string;
  mes: string;
  conta?: string;
  contas: readonly BankAccount[];
}) {
  const router = useRouter();

  function navegar(novoMes: string, novaConta: string | undefined) {
    router.push(routes.transactions(companyId, { month: novoMes, account: novaConta }));
  }

  const anterior = startOfMonth(addMonths(mes, -1));
  const proximo = startOfMonth(addMonths(mes, 1));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="border-border bg-card flex items-center gap-1 rounded-md border">
        <button
          type="button"
          onClick={() => navegar(anterior, conta)}
          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="min-w-40 px-2 text-center text-sm font-medium">{formatMonth(mes)}</span>
        <button
          type="button"
          onClick={() => navegar(proximo, conta)}
          className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
          aria-label="Proximo mes"
        >
          ›
        </button>
      </div>

      <Select
        value={conta ?? ""}
        onChange={(event) => navegar(mes, event.target.value || undefined)}
        className="w-auto"
      >
        <option value="">Todas as contas</option>
        {contas.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
