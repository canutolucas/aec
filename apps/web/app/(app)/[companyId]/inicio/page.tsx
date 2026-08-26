import { type BankAccount, type Category, hasRole } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { InicioClient } from "./inicio-client";

export const metadata = { title: "Início — Controle Bancario" };

export type InicioAccount = Pick<BankAccount, "id" | "name" | "bank_name">;

export default async function InicioPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const [accountsResult, categoriesResult] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("id, name, bank_name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("categories")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
  ]);

  if (accountsResult.error) throw accountsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;

  const canUpload = hasRole(session.role, "assistente");
  const accounts = (accountsResult.data ?? []) as InicioAccount[];
  const categories = (categoriesResult.data ?? []) as Category[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ola, {session.company.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Suba o extrato do banco abaixo e o mes fica organizado sozinho.
        </p>
      </div>

      {!canUpload ? (
        <Alert tone="info">
          Seu perfil pode consultar, mas nao subir extratos. Peca a um assistente, contador ou
          responsavel pela empresa.
        </Alert>
      ) : accounts.length === 0 ? (
        <Alert tone="warn">
          Nenhuma conta bancaria cadastrada ainda. Peca a um contador ou responsavel para cadastrar
          a conta antes de subir o primeiro extrato.
        </Alert>
      ) : (
        <InicioClient companyId={companyId} accounts={accounts} categories={categories} />
      )}
    </div>
  );
}
