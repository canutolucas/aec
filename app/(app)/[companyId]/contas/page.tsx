import { redirect } from "next/navigation";
import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { ACCOUNT_KIND_LABELS, type AccountBalance, hasRole } from "@/lib/db/types";
import { type Cents, fromDb, parseUserInput, sum, toDb } from "@/lib/domain/money";
import { todayInBrazil } from "@/lib/domain/dates";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Money,
  Select,
} from "@/lib/ui/components";
import { formatDate } from "@/lib/ui/format";
import { comQuery, rotas } from "@/lib/ui/rotas";

export const metadata = { title: "Contas — Controle Bancario" };

export default async function ContasPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { companyId } = await params;
  const { erro } = await searchParams;
  const session = await requireCompany(companyId);
  const podeEditar = hasRole(session.role, "contador");

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("v_account_balances")
    .select("*")
    .eq("company_id", companyId)
    .order("name");

  if (error) throw error;
  const contas = (data ?? []) as AccountBalance[];

  async function criarConta(formData: FormData) {
    "use server";

    const supabase = await createServerSupabase();
    const { error } = await supabase.from("bank_accounts").insert({
      company_id: companyId,
      name: String(formData.get("nome") ?? "").trim(),
      kind: String(formData.get("tipo") ?? "corrente"),
      bank_name: String(formData.get("banco") ?? "").trim() || null,
      branch: String(formData.get("agencia") ?? "").trim() || null,
      account_number: String(formData.get("conta") ?? "").trim() || null,
      // O valor digitado passa por parseUserInput e volta para numeric via toDb:
      // nunca ha um float no caminho entre a tela e o banco.
      opening_balance: toDb(parseAmountField(formData.get("saldo"))),
      opening_balance_date: String(formData.get("data") ?? todayInBrazil()),
      minimum_balance: formData.get("minimo")
        ? toDb(parseAmountField(formData.get("minimo")))
        : null,
    });

    if (error) redirect(comQuery(rotas.contas(companyId), { erro: error.message }));
    redirect(rotas.contas(companyId));
  }

  const totalAtual = sum(contas.map((conta) => fromDb(conta.current_balance)));
  const totalProjetado = sum(contas.map((conta) => fromDb(conta.projected_balance)));

  return (
    <div className="space-y-6">
      {erro && <Alert tone="error">{erro}</Alert>}

      <Card>
        <CardHeader title="Contas bancarias" />

        {contas.length === 0 ? (
          <EmptyState
            title="Nenhuma conta cadastrada"
            description="Cadastre cada conta com o saldo do dia em que voce vai parar de usar a planilha. Esse saldo e o ponto de partida: dali em diante o sistema calcula tudo a partir dos lancamentos."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--color-borda] text-left text-xs text-[--color-tinta-fraca]">
                <th className="px-4 py-2 font-medium">Conta</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Saldo inicial</th>
                <th className="px-4 py-2 text-right font-medium">Saldo hoje</th>
                <th className="px-4 py-2 text-right font-medium">Projetado</th>
                <th className="px-4 py-2 font-medium">Situacao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-borda]">
              {contas.map((conta) => {
                const saldo = fromDb(conta.current_balance);
                const minimo = conta.minimum_balance ? fromDb(conta.minimum_balance) : null;
                const pendentes = Number(conta.unreconciled_count);

                return (
                  <tr key={conta.bank_account_id}>
                    <td className="px-4 py-2">
                      <p className="font-medium">{conta.name}</p>
                      {conta.bank_name && (
                        <p className="text-xs text-[--color-tinta-fraca]">{conta.bank_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[--color-tinta-fraca]">
                      {ACCOUNT_KIND_LABELS[conta.kind]}
                    </td>
                    <td className="px-4 py-2 text-xs text-[--color-tinta-fraca]">
                      <span className="numero">{formatDate(conta.opening_balance_date)}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={saldo} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={fromDb(conta.projected_balance)} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {minimo !== null && saldo < minimo && (
                          <Badge tone="warn">abaixo do minimo</Badge>
                        )}
                        {pendentes > 0 && (
                          <Badge>{pendentes} a conciliar</Badge>
                        )}
                        {!conta.is_active && <Badge>inativa</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[--color-borda] font-semibold">
                <td className="px-4 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-2 text-right">
                  <Money cents={totalAtual} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Money cents={totalProjetado} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {podeEditar ? (
        <Card>
          <CardHeader title="Cadastrar conta" />
          <form action={criarConta} className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nome da conta">
              <Input name="nome" required placeholder="Itau Corrente" />
            </Field>

            <Field label="Tipo">
              <Select name="tipo" defaultValue="corrente">
                {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Banco">
              <Input name="banco" placeholder="Banco Itau" />
            </Field>

            <Field label="Agencia">
              <Input name="agencia" />
            </Field>

            <Field label="Conta">
              <Input name="conta" />
            </Field>

            <Field label="Saldo minimo" hint="Opcional. Alerta quando o saldo cair abaixo disso.">
              <Input name="minimo" inputMode="decimal" placeholder="0,00" />
            </Field>

            <Field
              label="Saldo inicial"
              hint="O saldo da conta na data abaixo, como esta no extrato."
            >
              <Input name="saldo" inputMode="decimal" placeholder="0,00" required />
            </Field>

            <Field
              label="Data do saldo inicial"
              hint="Lancamentos anteriores a esta data sao recusados: o saldo inicial ja os contem."
            >
              <Input name="data" type="date" defaultValue={todayInBrazil()} required />
            </Field>

            <div className="flex items-end">
              <Button type="submit">Cadastrar conta</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Alert tone="info">
          Seu perfil ({session.role}) nao permite cadastrar contas bancarias. Peca a quem tem perfil
          de contador ou responsavel.
        </Alert>
      )}
    </div>
  );
}

/** Le um campo de valor da tela. Vazio conta como zero. */
function parseAmountField(value: FormDataEntryValue | null): Cents {
  const raw = String(value ?? "").trim();
  return raw === "" ? 0 : parseUserInput(raw);
}
