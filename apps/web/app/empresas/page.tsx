import { ROLE_LABELS } from "@aec/db";
import { redirect } from "next/navigation";

import { listCompanies } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  LinkButton,
  Logo,
} from "@/lib/ui/components";
import { formatTaxId } from "@/lib/ui/format";
import { routes, withQuery } from "@/lib/ui/routes";

export const metadata = { title: "Empresas — Controle Bancario" };

export default async function EmpresasPage() {
  const companies = await listCompanies();

  async function criarEmpresa(formData: FormData) {
    "use server";

    const nome = String(formData.get("nome") ?? "").trim();
    const razao = String(formData.get("razao") ?? "").trim();
    const cnpj = String(formData.get("cnpj") ?? "").trim();

    const supabase = await createServerSupabase();
    // RPC porque criar empresa e criar o vinculo de dono precisam acontecer na
    // mesma transacao — ver public.create_company nas migrations.
    const { data, error } = await supabase.rpc("create_company", {
      p_name: nome,
      p_legal_name: razao || null,
      p_tax_id: cnpj || null,
    });

    if (error) redirect(withQuery(routes.companies, { erro: error.message }));
    redirect(routes.accounts((data as { id: string }).id));
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Logo className="text-2xl" />
      <h1 className="mt-4 text-xl font-semibold">Empresas</h1>

      {companies.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Suas empresas" />
          <ul className="divide-border divide-y">
            {companies.map((company) => (
              <li key={company.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{company.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatTaxId(company.tax_id)} {company.tax_id && "·"}{" "}
                    {ROLE_LABELS[company.role]}
                  </p>
                </div>
                <LinkButton href={routes.dashboard(company.id)}>Abrir</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Cadastrar empresa" />
        <form action={criarEmpresa} className="space-y-4 p-4">
          {companies.length === 0 && (
            <Alert tone="info">
              Cadastre a primeira empresa para comecar. Depois voce cria as contas bancarias com o
              saldo do dia em que vai parar de usar a planilha.
            </Alert>
          )}

          <Field label="Nome">
            <Input name="nome" required placeholder="Como voce chama a empresa no dia a dia" />
          </Field>

          <Field label="Razao social" hint="Opcional">
            <Input name="razao" />
          </Field>

          <Field label="CNPJ" hint="Opcional. Pode digitar com ou sem pontuacao.">
            <Input name="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" />
          </Field>

          <Button type="submit">Cadastrar</Button>
        </form>
      </Card>
    </main>
  );
}
