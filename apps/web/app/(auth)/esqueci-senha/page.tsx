import Link from "next/link";
import { redirect } from "next/navigation";

import { siteOrigin } from "@/lib/db/site-url";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert, Button, Field, Input, Logo } from "@/lib/ui/components";
import { routes, withQuery } from "@/lib/ui/routes";

export const metadata = { title: "Esqueci minha senha — Controle Bancario" };

export default async function EsqueciSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string }>;
}) {
  const params = await searchParams;

  async function enviar(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "").trim();

    if (email) {
      const origin = await siteOrigin();
      const supabase = await createServerSupabase();
      // Sem checar erro: dizer se o e-mail existe ou nao revelaria quais
      // contas tem conta no sistema — o mesmo raciocinio que a mensagem de
      // erro do login ja documenta (routes.ts / login/page.tsx).
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(routes.resetPassword)}`,
      });
    }

    redirect(withQuery(routes.forgotPassword, { enviado: "1" }));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo className="text-3xl" />
      <h1 className="text-primary mt-4 text-xl font-semibold">Esqueci minha senha</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Informe o e-mail da sua conta. Mandamos um link para trocar a senha.
      </p>

      {params.enviado === "1" ? (
        <div className="mt-6 space-y-4">
          <Alert tone="success">
            Se este e-mail tem uma conta, enviamos um link para trocar a senha. Confira sua caixa de
            entrada.
          </Alert>
          <Link
            href={routes.login}
            className="text-primary block text-sm underline-offset-2 hover:underline"
          >
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form action={enviar} className="mt-6 space-y-4">
          <Field label="E-mail">
            <Input name="email" type="email" required autoComplete="email" autoFocus />
          </Field>

          <Button type="submit" className="w-full">
            Enviar link
          </Button>

          <p className="text-muted-foreground text-center text-sm">
            <Link href={routes.login} className="text-primary underline-offset-2 hover:underline">
              Voltar para o login
            </Link>
          </p>
        </form>
      )}
    </main>
  );
}
