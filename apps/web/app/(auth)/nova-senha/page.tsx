import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/db/supabase";
import { Alert, Button, Field, Input, Logo } from "@/lib/ui/components";
import { routes, withQuery } from "@/lib/ui/routes";

export const metadata = { title: "Nova senha — Controle Bancario" };

const ERROS: Record<string, string> = {
  "senha-curta": "A senha precisa ter pelo menos 8 caracteres.",
  "senha-diferente": "As senhas digitadas não são iguais.",
  falha: 'Não foi possível trocar a senha. Peça um novo link em "Esqueci minha senha".',
};

/**
 * So chega aqui autenticado: o link do e-mail passa por /auth/callback, que
 * troca o `code` por uma sessao de verdade ANTES de mandar pra ca. Sem
 * sessao nenhuma, proxy.ts ja redireciona para /login antes desta pagina
 * renderizar — nao precisa checar de novo aqui.
 */
export default async function NovaSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const params = await searchParams;

  async function salvar(formData: FormData) {
    "use server";

    const senha = String(formData.get("senha") ?? "");
    const confirmacao = String(formData.get("confirmacao") ?? "");

    if (senha.length < 8) redirect(withQuery(routes.resetPassword, { erro: "senha-curta" }));
    if (senha !== confirmacao) {
      redirect(withQuery(routes.resetPassword, { erro: "senha-diferente" }));
    }

    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) redirect(withQuery(routes.resetPassword, { erro: "falha" }));

    redirect(routes.companies);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo className="text-3xl" />
      <h1 className="text-primary mt-4 text-xl font-semibold">Escolha uma nova senha</h1>

      {params.erro && ERROS[params.erro] && (
        <div className="mt-4">
          <Alert tone="error">{ERROS[params.erro]}</Alert>
        </div>
      )}

      <form action={salvar} className="mt-6 space-y-4">
        <Field label="Nova senha" hint="Pelo menos 8 caracteres.">
          <Input name="senha" type="password" required autoComplete="new-password" autoFocus />
        </Field>

        <Field label="Confirmar nova senha">
          <Input name="confirmacao" type="password" required autoComplete="new-password" />
        </Field>

        <Button type="submit" className="w-full">
          Salvar nova senha
        </Button>
      </form>
    </main>
  );
}
