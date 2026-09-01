import Link from "next/link";
import { redirect } from "next/navigation";

import { siteOrigin } from "@/lib/db/site-url";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert, Button, Field, Input, Logo } from "@/lib/ui/components";
import { routes, withQuery } from "@/lib/ui/routes";

export const metadata = { title: "Criar conta — Controle Bancario" };

const ERROS: Record<string, string> = {
  nome: "Informe seu nome.",
  "senha-curta": "A senha precisa ter pelo menos 8 caracteres.",
  "senha-diferente": "As senhas digitadas não são iguais.",
  falha: "Não foi possível criar a conta. Confira o e-mail e tente de novo.",
};

export default async function CadastrarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; enviado?: string }>;
}) {
  const params = await searchParams;

  async function cadastrar(formData: FormData) {
    "use server";

    const nome = String(formData.get("nome") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const senha = String(formData.get("senha") ?? "");
    const confirmacao = String(formData.get("confirmacao") ?? "");

    if (!nome) redirect(withQuery(routes.signUp, { erro: "nome" }));
    if (senha.length < 8) redirect(withQuery(routes.signUp, { erro: "senha-curta" }));
    if (senha !== confirmacao) redirect(withQuery(routes.signUp, { erro: "senha-diferente" }));

    const origin = await siteOrigin();
    const supabase = await createServerSupabase();

    // full_name vai em raw_user_meta_data — e o que o trigger
    // on_auth_user_created (20250101000000_core.sql) le pra popular
    // public.profiles.full_name. Sem isso, a pessoa aparece pelo e-mail em
    // /equipe e /auditoria em vez do nome.
    const { data, error } = await supabase.auth.signUp({
      email,
      password: senha,
      options: {
        data: { full_name: nome },
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(routes.companies)}`,
      },
    });

    if (error) redirect(withQuery(routes.signUp, { erro: "falha" }));

    // Com confirmacao de e-mail desligada no projeto Supabase, signUp ja
    // devolve sessao — a pessoa entra direto. Com confirmacao ligada (o
    // padrao), session vem nula ate ela clicar o link do e-mail.
    if (data.session) redirect(routes.companies);

    redirect(withQuery(routes.signUp, { enviado: "1" }));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo className="text-3xl" />
      <h1 className="text-primary mt-4 text-xl font-semibold">Criar conta</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Para acessar o Controle Bancário da sua empresa.
      </p>

      {params.enviado === "1" ? (
        <div className="mt-6 space-y-4">
          <Alert tone="success">
            Enviamos um e-mail de confirmação. Abra o link para ativar sua conta e continuar.
          </Alert>
          <Link
            href={routes.login}
            className="text-primary block text-sm underline-offset-2 hover:underline"
          >
            Voltar para o login
          </Link>
        </div>
      ) : (
        <>
          {params.erro && ERROS[params.erro] && (
            <div className="mt-4">
              <Alert tone="error">{ERROS[params.erro]}</Alert>
            </div>
          )}

          <form action={cadastrar} className="mt-6 space-y-4">
            <Field label="Nome">
              <Input name="nome" required autoComplete="name" autoFocus />
            </Field>

            <Field label="E-mail">
              <Input name="email" type="email" required autoComplete="email" />
            </Field>

            <Field label="Senha" hint="Pelo menos 8 caracteres.">
              <Input name="senha" type="password" required autoComplete="new-password" />
            </Field>

            <Field label="Confirmar senha">
              <Input name="confirmacao" type="password" required autoComplete="new-password" />
            </Field>

            <Button type="submit" className="w-full">
              Criar conta
            </Button>
          </form>

          <p className="text-muted-foreground mt-4 text-center text-sm">
            Já tem conta?{" "}
            <Link href={routes.login} className="text-primary underline-offset-2 hover:underline">
              Entrar
            </Link>
          </p>
        </>
      )}
    </main>
  );
}
