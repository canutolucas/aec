# Como colocar a plataforma no ar

**Ja esta publicada** — Vercel (a partir desta branch) + Supabase na nuvem. O
guia abaixo documenta como esse ambiente foi montado e como redeployar do
zero se algum dia precisar (um projeto Vercel/Supabase novo, uma segunda
instalacao). Ha dois caminhos, e eles servem a proposito diferente.

| Caminho      | Onde roda         | Quem acessa                         | Quando usar             |
| ------------ | ----------------- | ----------------------------------- | ----------------------- |
| **A. Local** | na maquina dela   | so ela, naquele computador          | testar antes de decidir |
| **B. Nuvem** | Vercel + Supabase | qualquer navegador, celular incluso | uso de verdade          |

Comece pelo A se a ideia e conferir se a ferramenta serve. Va direto para o B se
ela ja vai usar no dia a dia — o A nao tem backup nem acesso remoto.

---

## A. Rodar na maquina dela

Precisa de quatro coisas instaladas: [Node 22+](https://nodejs.org),
[pnpm](https://pnpm.io) 10, [Docker Desktop](https://www.docker.com/products/docker-desktop/)
e o [Supabase CLI](https://supabase.com/docs/guides/cli). O Docker e exigencia
do Supabase local, que sobe Postgres, autenticacao e storage em containers.

```bash
git clone https://github.com/canutolucas/aec.git
cd aec
git checkout claude/accounting-bank-control-platform-b7drpl
pnpm install

supabase start                     # imprime as chaves locais no fim
cp apps/web/.env.example apps/web/.env.local
# cole em NEXT_PUBLIC_SUPABASE_ANON_KEY a chave "anon key" que apareceu

pnpm db:reset                      # aplica as migrations e os dados de exemplo
pnpm dev                           # sobe o app web via Turborepo
```

Abra <http://localhost:3000> e entre com `responsavel@assessoria.teste`, senha
`senha-de-teste-123`.

Esses dados sao **de exemplo**: duas empresas ficticias com dois meses de
movimento, para ela navegar sem cadastrar nada. Nao servem para uso real.

---

## B. Publicar na nuvem

Gera uma URL de verdade, com backup automatico e acesso pelo celular. Custo:
faixa gratuita nos dois servicos para o tamanho de uma assessoria; cerca de
US$ 45/mes quando crescer. **E o caminho ja em uso** — os passos abaixo sao a
referencia de como foi feito, para redeployar do zero se precisar.

### O que eu preciso de voce

As contas sao dela e ficam no nome dela — eu nao crio conta em nome de ninguem, e
voce nao deve me passar senha nem token de acesso. Sao dois cadastros gratuitos:

1. Uma conta em [supabase.com](https://supabase.com) com um projeto criado
   (regiao **South America (Sao Paulo)**, que deixa o sistema mais rapido e
   mantem os dados no Brasil).
2. Uma conta em [vercel.com](https://vercel.com).

Com isso feito, me diga e eu conduzo o resto.

### Passo 1 — banco

No painel do Supabase, em **Settings > API**, copie o `Project URL` e a
`anon public` key. Em **Settings > General**, copie o `Reference ID`.

```bash
supabase link --project-ref SEU_REFERENCE_ID
supabase db push          # aplica as migrations no banco da nuvem
```

**Nao rode os seeds em producao.** Eles criam usuarios com senha conhecida, que e
util para desenvolver e inaceitavel em um sistema com dados de clientes.

### Passo 2 — usuario dela

Em **Authentication > Users > Add user**, crie o usuario com o e-mail real e
marque _Auto Confirm User_.

Em **Authentication > Providers > Email**, desligue **Enable signup**. Sem isso,
qualquer pessoa que descobrisse a URL criaria uma conta sozinha. O
`supabase/config.toml` do repositorio ja deixa isso desligado, mas ele vale
apenas para o ambiente local — o da nuvem se configura pelo painel.

### Passo 3 — aplicacao

Na Vercel, **Add New > Project**, importe `canutolucas/aec` e escolha a branch
`claude/accounting-bank-control-platform-b7drpl`. O repositorio e um monorepo
pnpm/Turborepo: em **Root Directory**, aponte para `apps/web` (a Vercel
detecta o Next.js automaticamente a partir dai; o `pnpm-workspace.yaml` na
raiz garante que `pnpm install` traga tambem os pacotes de `packages/*`). Em
**Environment Variables**:

| Variavel                        | Valor                          |
| ------------------------------- | ------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | o `Project URL` do passo 1     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a `anon public` key do passo 1 |

A `service_role` key **nao entra aqui**. Ela atravessa o isolamento entre
empresas e tornaria decorativas todas as policies de seguranca do banco. A
aplicacao inteira funciona com a chave `anon`, autenticada como quem esta usando.

Clique em **Deploy**. Sai uma URL do tipo `aec-xxxx.vercel.app`.

### Passo 4 — fechar o circuito

Volte ao Supabase, em **Authentication > URL Configuration**, e ponha a URL da
Vercel em **Site URL**. Sem isso o login redireciona para o endereco errado.

### Passo 5 — primeiro acesso

Entre com o usuario do passo 2. Como ainda nao ha empresa, o sistema leva direto
para o cadastro. Crie a empresa, depois as contas bancarias — cada uma com o saldo
do dia em que ela vai parar de usar a planilha.

---

## Antes de desligar o Excel

1. Reproduza **um mes ja fechado da planilha** inteiro na plataforma.
2. Confira que o saldo final de cada conta bate com o Excel **e** com o extrato.
3. Importe o OFX desse mesmo mes e verifique que a conciliacao fecha em 100%.
4. Rode uma semana em paralelo antes de abandonar a planilha.

## Depois que estiver no ar

- **Ative o segundo fator** (Authentication > Providers > MFA). Sao dados
  financeiros de terceiros.
- **Confira o backup**: na faixa gratuita do Supabase a retencao e curta. Ao
  passar para o plano pago, o backup diario vem junto.
- **Um usuario por pessoa**, com o papel certo. O `assistente` lanca e concilia
  mas nao fecha o mes; o `cliente_leitura` so le. Conta compartilhada apaga a
  trilha de auditoria, que e boa parte do motivo de sair da planilha.
