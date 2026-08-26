"use client";

import type { BankAccount } from "@aec/db";
import { useRouter } from "next/navigation";

import { Select } from "@/lib/ui/components";
import { routes, withQuery } from "@/lib/ui/routes";

export function FiltroPeriodo({
  companyId,
  de,
  ate,
  conta,
  contas,
}: {
  companyId: string;
  de: string;
  ate: string;
  conta?: string;
  contas: readonly BankAccount[];
}) {
  const router = useRouter();

  function navegar(novoDe: string, novoAte: string, novaConta: string | undefined) {
    router.push(
      withQuery(routes.reports(companyId), { de: novoDe, ate: novoAte, conta: novaConta }),
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="text-muted-foreground mb-1 block text-xs">De</span>
        <input
          type="date"
          value={de}
          onChange={(event) => navegar(event.target.value, ate, conta)}
          className="border-input bg-card rounded-md border px-3 py-2 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground mb-1 block text-xs">Ate</span>
        <input
          type="date"
          value={ate}
          onChange={(event) => navegar(de, event.target.value, conta)}
          className="border-input bg-card rounded-md border px-3 py-2 text-sm"
        />
      </label>
      <Select
        value={conta ?? ""}
        onChange={(event) => navegar(de, ate, event.target.value || undefined)}
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
