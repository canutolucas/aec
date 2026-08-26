# Controle Bancario

Plataforma para uma assessoria contabil controlar as entradas e saidas das
contas bancarias de seus clientes, alimentada diariamente e conciliada com o
extrato do banco. Substitui a planilha de Excel usada hoje.

O que a planilha nao faz e esta aqui:

- **Trava de mes fechado.** Depois de fechado, o mes nao aceita mais escrita. A
  reabertura exige motivo e fica registrada com autor e data.
- **Conciliacao com o extrato.** Importa OFX, CSV ou o PDF do Cora e aponta,
  linha a linha, o que falta lancar e o que foi lancado mas nao aconteceu.
- **Trilha de auditoria.** Quem alterou, quando, e de quanto para quanto.
- **Fluxo de caixa projetado.** A data exata em que o caixa fura, se furar.
- **Isolamento entre empresas.** Aplicado no banco por RLS, nao por filtro no
  codigo da aplicacao.

## Estado atual

| Fase | Escopo                                              | Situacao                                                                                                                                                |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Fundacao, schema, RLS, autenticacao                 | pronto                                                                                                                                                  |
| 1    | Contas bancarias, lancamentos, saldo, transferencia | pronto                                                                                                                                                  |
| 2    | Conciliacao bancaria                                | pronto: importa OFX/CSV/PDF, sugere pareamento, cria lancamento ou ignora linha sem par, prova o saldo contra o extrato, aprende regra de categorizacao |
| 3    | Fluxo de caixa projetado                            | dominio pronto; usado no painel                                                                                                                         |
| 4    | Relatorios, dashboard, fechamento pela tela         | pendente                                                                                                                                                |
| 5    | Migracao da planilha e carteira multiempresa        | modelo pronto; telas pendentes                                                                                                                          |

O schema ja e multiempresa desde o primeiro dia. Habilitar a carteira e
configuracao, nao refatoracao.

## Como rodar

Precisa de Node 22, [pnpm](https://pnpm.io) 10 e do
[Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
pnpm install
supabase start                     # sobe Postgres, Auth e Storage locais
cp apps/web/.env.example apps/web/.env.local
# preencha NEXT_PUBLIC_SUPABASE_ANON_KEY com a chave que o `supabase start` imprimiu
pnpm db:reset                      # aplica as migrations e os dados de exemplo
pnpm dev                           # roda todos os apps via Turborepo
```

Abra http://localhost:3000 e entre com um dos usuarios de exemplo (senha
`senha-de-teste-123`):

| E-mail                         | Papel       | Para que serve                    |
| ------------------------------ | ----------- | --------------------------------- |
| `responsavel@assessoria.teste` | Responsavel | acesso total, duas empresas       |
| `assistente@assessoria.teste`  | Assistente  | lanca e concilia, nao fecha o mes |
| `cliente@empresa-a.teste`      | Cliente     | somente leitura, uma empresa      |

Entrar com dois deles em janelas separadas e a forma mais rapida de ver o
isolamento entre empresas e as permissoes por papel funcionando.

## Verificacao

```bash
pnpm check       # typecheck, lint e testes de todos os pacotes e apps (via Turborepo)
pnpm test:sql    # schema, RLS, trava de mes e seeds, em Postgres puro
```

`pnpm test:sql` **nao precisa de Docker nem do Supabase CLI**: sobe um
Postgres descartavel e aplica um stub do que o Supabase fornece pronto (schema
`auth`, `auth.uid()` e os papeis do PostgREST). Ele atua como usuarios reais, com
`set role authenticated` e o claim `sub` — testar RLS como superusuario nao
testaria nada, porque o superusuario passa por cima de toda policy.

### O teste que realmente importa

Antes de desligar o Excel:

1. Reproduza **um mes ja fechado da planilha atual** inteiro na plataforma.
2. Confira que o saldo final de cada conta bate com o Excel **e** com o extrato.
3. Importe o OFX desse mesmo mes e verifique que a conciliacao fecha em 100%.
4. Rode uma semana em paralelo, planilha e sistema, antes de abandonar a
   planilha.

## Formatos de extrato aceitos

| Formato    | Identificador da transacao | Nome da contraparte | CNPJ/CPF         | Recomendacao                      |
| ---------- | -------------------------- | ------------------- | ---------------- | --------------------------------- |
| **OFX**    | FITID do banco             | completo            | sim              | **prefira este**                  |
| CSV        | nenhum                     | completo            | depende do banco | bom, com o mapeamento configurado |
| PDF (Cora) | nenhum                     | **truncado**        | sim              | ultimo recurso                    |

Peca OFX ao banco sempre que ele oferecer. O FITID e um identificador que o
proprio banco atribui a cada transacao, o que torna a deduplicacao exata: sem
ele, reimportar um periodo que se sobrepoe depende de comparar data, valor e
historico, e dois pagamentos identicos no mesmo dia ficam indistinguiveis.

Os dois leitores foram validados um contra o outro com o **mesmo mes** do mesmo
banco, em PDF e em OFX. Eles nao compartilham codigo de leitura — um interpreta
geometria de pagina, o outro interpreta tags — e mesmo assim concordam nas 43
transacoes, transacao a transacao, no documento de cada contraparte, no periodo
coberto e no saldo. O saldo inicial que o OFX apenas implica (saldo final menos o
movimento) coincide ao centavo com o que o PDF declara diretamente. Se algum dos
dois tivesse perdido ou duplicado uma linha, nao coincidiriam.

### Sobre o PDF

O leitor de PDF existe porque e o que costuma estar a mao, mas ele carrega
limitacoes que convem conhecer antes de depender dele:

- **O nome da contraparte vem cortado.** Num extrato real de agosto de 2026, 27
  de 43 nomes chegaram truncados ("Le Va Tout Do Brasil L…"). Regra de
  categorizacao por nome fica pela metade.
- **Nao ha identificador de transacao.** A deduplicacao usa data, valor e
  historico.
- **O layout e diagramacao, nao contrato.** Quando o banco mudar o desenho da
  pagina, o leitor para de funcionar.

Duas coisas compensam, e sao o motivo de o leitor ser confiavel apesar do
formato:

**O CNPJ/CPF vem inteiro, mesmo quando o nome vem cortado.** Ele e uma chave
melhor do que o nome jamais seria: nao muda, nao abrevia e nao depende de como o
banco escreveu. Monte as regras de categorizacao pelo documento — vale para os
dois formatos, ja que o leitor de OFX tambem extrai o documento do historico
quando o banco o escreve la.

**O extrato declara os totais e o saldo de cada dia, e o leitor refaz essas
contas.** Isso ataca o pior modo de falha de um leitor de PDF, que nao e quebrar
— e ler errado e seguir em frente. Uma linha perdida produziria um saldo
plausivel, e a diferenca so apareceria no fechamento, quando ninguem mais liga
uma coisa a outra. Aqui a conferencia aponta _em que dia_ a leitura divergiu, na
hora da importacao.

### Extrato parcial

Os dois leitores detectam quando o arquivo cobre menos do que diz cobrir. Um
extrato pedido no dia 25 para o mes inteiro sai declarando 01 a 31, mas nao tem
como conter o que ainda nao aconteceu. Importar 31/08 como fim do periodo faria o
sistema tratar agosto como coberto, e os dias 26 a 31 nunca seriam cobrados de
ninguem.

Cada leitor chega a mesma conclusao por um caminho: o do PDF pelo ultimo saldo
diario impresso, o do OFX pela data de geracao no `DTSERVER`. No OFX o corte e
pela data de geracao, e nao pelo ultimo lancamento, de proposito — nao haver
movimento nos ultimos dias e informacao legitima do extrato, nao lacuna.

### O que cada formato consegue provar

O PDF traz o saldo de cada dia, entao o leitor prova sozinho que nao perdeu
nenhuma linha, e diz em que dia divergiu.

O OFX traz o saldo final mas nao o inicial, entao o arquivo **nao se prova
sozinho** — ele afirma um total. O leitor registra o saldo inicial _implicado_
(final menos o movimento) para a aplicacao confrontar com o saldo que ela ja tem
para a conta na vespera. E a mesma conferencia, fechada do lado de fora.

### Extratos reais nos testes

Extrato de verdade contem CNPJ, nome e valor de clientes e fornecedores reais,
alem do numero da conta — a carteira da assessoria. **Isso nao entra em
repositorio**, nem privado.

As fixtures versionadas sao anonimizadas: preservam a geometria exata do PDF
(coordenadas, recuos, colunas, nomes truncados, ordem invertida, paginacao) com
nomes, documentos e valores fabricados. O gerador em `tests/local/` deriva a
lista do que precisa ser trocado do proprio arquivo, em vez de te-la escrita a
mao — escrever a mao exigiria colar dados reais em um arquivo versionado, que
seria exatamente o vazamento a evitar.

Para conferir um leitor contra um extrato de verdade, coloque o arquivo em
`packages/statements/tests/local/` (pasta ignorada pelo git) e rode
`pnpm --filter @aec/statements test`. Sem arquivo, esses testes se declaram
pulados.

## Como o codigo esta organizado

Monorepo pnpm + Turborepo: `apps/*` sao as superficies (web completo; mobile
com login, painel e lancamento rapido, ainda sem NativeWind nem testado num
simulador), `packages/*` e o que elas compartilham. Nao ha `apps/backend`
— o Supabase (PostgREST + RLS + Auth) e o backend.

```
apps/
  web/                       Next.js — telas, Tailwind, shadcn/ui, TanStack
  mobile/                    Expo Router — login, painel, lancamento rapido
packages/
  domain/                    REGRAS PURAS, sem I/O — toda conta de dinheiro
  statements/
    src/universal/           OFX, CSV, dedup — roda em web e mobile
    src/node/                PDF, leitor Cora — so roda em Node (unpdf)
  db/                        cliente Supabase tipado (schema gerado), queries
                              e hooks TanStack Query, compartilhados web/mobile
  ui/                        tema de marca (TweakCN) e componentes shadcn
  utils/                     constantes compartilhadas
supabase/migrations/         schema versionado
tests/sql/                   testes de schema, RLS e seeds
```

`packages/db/src/database.types.ts` e gerado a partir do schema real por
`packages/db/scripts/generate-types.mjs` (introspeccao direta via `pg`, sem
depender do Supabase CLI nem de Docker). Regenerar depois de qualquer migration:

```bash
su postgres -c 'bash packages/db/scripts/dev-db.sh'
# imprime a connection string; regenera os tipos contra ela
node packages/db/scripts/generate-types.mjs "postgresql://postgres@127.0.0.1:54395/aec_dev"
pnpm exec prettier --write packages/db/src/database.types.ts
# quando terminar, o proprio dev-db.sh imprime o comando pra derrubar o Postgres
```

`dev-db.sh` existe separado de `tests/sql/run.sh` porque este ultimo derruba o
Postgres assim que termina (e certo para um teste, inutil para gerar tipos
contra ele) — o primeiro sobe a mesma base e deixa rodando.

Cada pacote roda os proprios `type-check`/`lint`/`test` via `pnpm turbo run
<tarefa>`; os pacotes exportam o TypeScript fonte diretamente (sem build
step), resolvido via symlinks do pnpm.

### Tres regras que valem para o repositorio inteiro

**1. Conta de dinheiro so mora em `packages/domain/`.** Sao funcoes puras, sem
I/O e sem relogio, e sao as unicas que somam valores. Repetir a mesma soma em
SQL e em TypeScript garante que as duas versoes divirjam com o tempo.

**2. Dinheiro e inteiro de centavos; datas de caixa sao `date`.** Ponto flutuante
nunca toca valor monetario — `0.1 + 0.2` nao da `0.3`, e um relatorio que fecha
com um centavo de diferenca custa mais conferencia do que o mes inteiro de
lancamento. Data de lancamento e dia de calendario, nao instante, o que elimina
por construcao o lancamento do dia 1o que aparece no dia 31 do mes anterior.

**3. Saldo nunca e campo mutavel.** Deriva sempre de `opening_balance` mais o
movimento. Saldo armazenado e editavel e a origem numero um de divergencia em
sistema financeiro: basta um caminho de escrita esquecido para o numero passar a
mentir, sem nada que acuse.

## Seguranca

O isolamento entre empresas e a trava de mes fechado sao **policies de RLS**, no
banco. Uma consulta que esqueca o `where company_id = ...` devolve zero linhas em
vez de vazar dados de outro cliente.

A aplicacao nunca usa a _service role_ do Supabase: toda consulta e feita
autenticada como a pessoa que esta usando o sistema. Um cliente com service role
atravessaria o RLS e tornaria todas as policies decorativas.

As checagens de papel na interface servem para esconder o que a pessoa nao pode
fazer — botao que so devolve erro e uma cortesia ruim. Elas **nao sao** o
controle de acesso: se a interface e o banco discordarem, quem vale e o banco.

Como sao dados financeiros de terceiros, o MFA esta habilitado e a auto-inscricao
esta desligada: usuarios sao criados por quem administra.
