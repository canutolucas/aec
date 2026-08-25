"use client";

import { useRouter } from "next/navigation";
import type { BankAccount } from "@/lib/db/types";
import { addMonths, startOfMonth } from "@/lib/domain/dates";
import { formatMonth } from "@/lib/ui/format";
import { Select } from "@/lib/ui/components";
import { rotas } from "@/lib/ui/rotas";

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
    router.push(rotas.lancamentos(companyId, { mes: novoMes, conta: novaConta }));
  }

  const anterior = startOfMonth(addMonths(mes, -1));
  const proximo = startOfMonth(addMonths(mes, 1));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-md border border-[--color-borda] bg-[--color-superficie]">
        <button
          type="button"
          onClick={() => navegar(anterior, conta)}
          className="px-3 py-2 text-sm text-[--color-tinta-fraca] hover:text-[--color-tinta]"
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <span className="min-w-40 px-2 text-center text-sm font-medium">{formatMonth(mes)}</span>
        <button
          type="button"
          onClick={() => navegar(proximo, conta)}
          className="px-3 py-2 text-sm text-[--color-tinta-fraca] hover:text-[--color-tinta]"
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
