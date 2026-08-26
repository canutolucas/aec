import { hasRole, type InvoiceBalance } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { FaturamentoClient } from "./faturamento-client";

export const metadata = { title: "Faturamento — Controle Bancario" };

export default async function FaturamentoPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("v_invoice_balances")
    .select("*")
    .eq("company_id", companyId)
    .order("issued_on", { ascending: false });
  if (error) throw error;

  const podeImportar = hasRole(session.role, "assistente");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Faturamento</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Importe o XML de cada nota fiscal emitida. O recebimento e conciliado em Recebimentos,
          quando o extrato do banco chegar.
        </p>
      </div>

      {!podeImportar && (
        <Alert tone="info">
          Seu perfil pode consultar, mas nao pode importar notas fiscais. Peca a um assistente,
          contador ou responsavel.
        </Alert>
      )}

      <FaturamentoClient
        companyId={companyId}
        podeImportar={podeImportar}
        invoices={(data ?? []) as InvoiceBalance[]}
      />
    </div>
  );
}
