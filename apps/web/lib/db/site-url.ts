/**
 * Origem (protocolo + host) da requisicao atual, para montar o link de
 * confirmacao de e-mail e de redefinicao de senha que o Supabase Auth manda
 * por fora do app.
 *
 * Nao ha `NEXT_PUBLIC_SITE_URL` no projeto (ver .env.example) — em vez de
 * inventar uma variavel nova so pra isso, le o host da propria requisicao
 * (o mesmo dado que a Vercel ja envia via `x-forwarded-*`), que funciona
 * igual em localhost, preview e producao sem configuracao extra.
 */

import { headers } from "next/headers";

export async function siteOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
