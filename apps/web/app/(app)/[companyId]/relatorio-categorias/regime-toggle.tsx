"use client";

/**
 * v_monthly_category_summary sempre expos period_cash E period_accrual —
 * nenhuma tela consultava a segunda coluna. Caixa e a pergunta "quando o
 * dinheiro andou"; competencia e "a que mes aquele gasto/receita pertence",
 * mesmo que o dinheiro tenha andado antes ou depois (o boleto de dezembro
 * pago em janeiro ainda e despesa de dezembro por competencia).
 */

import { useRouter } from "next/navigation";

import { routes, withQuery } from "@/lib/ui/routes";

export function RegimeToggle({
  companyId,
  mes,
  regime,
}: {
  companyId: string;
  mes: string;
  regime: "caixa" | "competencia";
}) {
  const router = useRouter();

  function navegar(novoRegime: "caixa" | "competencia") {
    router.push(
      withQuery(routes.categoryReport(companyId), {
        mes,
        regime: novoRegime === "caixa" ? undefined : novoRegime,
      }),
    );
  }

  return (
    <div className="border-border bg-card flex w-fit items-center gap-1 rounded-md border p-1 text-sm">
      <button
        type="button"
        onClick={() => navegar("caixa")}
        className={
          regime === "caixa"
            ? "bg-primary text-primary-foreground rounded px-3 py-1 font-medium"
            : "text-muted-foreground hover:text-foreground rounded px-3 py-1"
        }
      >
        Por caixa
      </button>
      <button
        type="button"
        onClick={() => navegar("competencia")}
        className={
          regime === "competencia"
            ? "bg-primary text-primary-foreground rounded px-3 py-1 font-medium"
            : "text-muted-foreground hover:text-foreground rounded px-3 py-1"
        }
      >
        Por competência
      </button>
    </div>
  );
}
