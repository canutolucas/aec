/**
 * Rotas da aplicacao, em um lugar so.
 *
 * O `typedRoutes` do Next valida rotas estaticas, mas nao consegue validar uma
 * rota dinamica montada em tempo de execucao: `/${string}/painel` nao satisfaz
 * `SafeSlug`, porque uma string qualquer poderia conter barra. A saida seria
 * espalhar `as Route` por cada link do sistema.
 *
 * Em vez disso, o cast fica aqui, uma vez, e o resto do codigo chama funcoes.
 * Alem de evitar a repeticao, isso da uma checagem que o cast espalhado nao
 * daria: nao ha como errar o caminho, porque nao se escreve caminho — mudar uma
 * rota e mudar esta funcao.
 */

import type { Route } from "next";

export const rotas = {
  raiz: "/" as Route,
  login: "/login" as Route,
  empresas: "/empresas" as Route,

  painel: (companyId: string) => `/${companyId}/painel` as Route,
  contas: (companyId: string) => `/${companyId}/contas` as Route,
  lancamentos: (companyId: string, filtros?: { mes?: string; conta?: string }) => {
    const query = new URLSearchParams();
    if (filtros?.mes) query.set("mes", filtros.mes);
    if (filtros?.conta) query.set("conta", filtros.conta);
    const sufixo = query.size > 0 ? `?${query.toString()}` : "";
    return `/${companyId}/lancamentos${sufixo}` as Route;
  },
} as const;

/**
 * Valida o destino guardado no login antes de redirecionar.
 *
 * Aceita apenas caminho interno comecando com uma barra. Sem isso, um link
 * `/login?destino=https://site-falso` faria o proprio sistema jogar a pessoa em
 * um endereco de terceiro logo depois de ela digitar a senha — o open redirect
 * classico, que e exatamente o que se usa em phishing.
 */
export function destinoSeguro(destino: string | undefined): Route {
  if (!destino) return rotas.raiz;
  if (!destino.startsWith("/") || destino.startsWith("//")) return rotas.raiz;
  return destino as Route;
}

/** Acrescenta parametros de consulta a uma rota, preservando a tipagem. */
export function comQuery(rota: Route, params: Record<string, string | undefined>): Route {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") query.set(chave, valor);
  }
  return (query.size > 0 ? `${rota}?${query.toString()}` : rota) as Route;
}
