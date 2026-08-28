/**
 * Resolucao pura da selecao de perfis (lentes gerenciais de contas) a partir
 * da URL — nenhum acesso a banco aqui, so a URL <-> conjunto de contas.
 * Separado das Server Actions de account-profiles.ts porque um arquivo
 * "use server" so pode exportar funcao assincrona; isto e usado tanto no
 * servidor (pagina resolvendo o filtro) quanto no cliente (o seletor lendo o
 * mesmo parametro).
 */

import type { AccountProfileWithAccounts } from "@aec/db";

/** Nome do parametro de busca que guarda a selecao — compartilhado por toda tela. */
export const PERFIL_PARAM = "perfil";

export interface PerfilSelecao {
  /** ids de perfil selecionados (vazio = nenhum perfil escolhido = "todos"). */
  readonly perfilIds: readonly string[];
  /**
   * Contas resultantes da selecao. `null` significa "sem filtro" — todas as
   * contas da empresa, o padrao quando nenhum perfil esta selecionado.
   */
  readonly bankAccountIds: readonly string[] | null;
}

/**
 * Le `?perfil=id1,id2` e resolve para o conjunto de contas correspondente.
 * Um id que nao bate com nenhum perfil ativo (perfil apagado, ou um link
 * velho) e ignorado silenciosamente — cai de volta em "todos" se sobrar
 * vazio, nunca quebra a tela.
 */
export function resolvePerfilSelecao(
  perfilParam: string | undefined,
  perfis: readonly AccountProfileWithAccounts[],
): PerfilSelecao {
  const idsPedidos = (perfilParam ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (idsPedidos.length === 0) return { perfilIds: [], bankAccountIds: null };

  const perfisById = new Map(perfis.map((perfil) => [perfil.id, perfil]));
  const perfisValidos = idsPedidos.filter((id) => perfisById.has(id));
  if (perfisValidos.length === 0) return { perfilIds: [], bankAccountIds: null };

  const contas = new Set<string>();
  for (const id of perfisValidos) {
    for (const contaId of perfisById.get(id)!.bankAccountIds) contas.add(contaId);
  }
  return { perfilIds: perfisValidos, bankAccountIds: [...contas] };
}

/** Serializa a selecao de volta para o valor do parametro de busca. */
export function serializePerfilSelecao(perfilIds: readonly string[]): string | undefined {
  return perfilIds.length > 0 ? perfilIds.join(",") : undefined;
}
