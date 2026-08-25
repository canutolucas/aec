import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert, Button, Field, Input } from "@/lib/ui/components";
import { comQuery, destinoSeguro, rotas } from "@/lib/ui/rotas";

export const metadata = { title: "Entrar — Controle Bancario" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; destino?: string; enviado?: string }>;
}) {
  const params = await searchParams;

  async function entrar(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim();
    const senha = String(formData.get("senha") ?? "");
    const destino = String(formData.get("destino") ?? "/");

    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      // Mensagem deliberadamente generica: dizer "usuario nao existe" revelaria
      // quais e-mails tem conta no sistema para quem so esta tentando descobrir.
      redirect(comQuery(rotas.login, { erro: "credenciais" }));
    }

    redirect(destinoSeguro(destino));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">Controle Bancario</h1>
      <p className="mt-1 text-sm text-[--color-tinta-fraca]">
        Entradas e saidas das contas, conciliadas com o extrato do banco.
      </p>

      {params.erro === "credenciais" && (
        <div className="mt-4">
          <Alert tone="error">E-mail ou senha incorretos.</Alert>
        </div>
      )}

      <form action={entrar} className="mt-6 space-y-4">
        <input type="hidden" name="destino" value={params.destino ?? "/"} />

        <Field label="E-mail">
          <Input name="email" type="email" required autoComplete="email" autoFocus />
        </Field>

        <Field label="Senha">
          <Input name="senha" type="password" required autoComplete="current-password" />
        </Field>

        <Button type="submit" className="w-full">
          Entrar
        </Button>
      </form>
    </main>
  );
}
