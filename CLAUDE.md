# AEC — Controle Bancário / Contábil

Plataforma de conciliação bancária e faturamento para um escritório de
contabilidade (nome real: AEC Assessoria Empresarial e Contábil, Salvador/BA).
Dono do projeto: Lucas (lucasbccanuto@gmail.com). Usuária final do dia a dia:
sua sogra, que opera a contabilidade da empresa.

Este arquivo é o resumo de estado do projeto — escrito para sobreviver a um
`/clear` de contexto. Leia antes de continuar qualquer trabalho aqui.

## Stack e estrutura

pnpm + Turborepo monorepo:

- `apps/web` — Next.js 16 (App Router, Turbopack, Server Actions). O app real,
  em produção. **É também o app de celular** — não existe app nativo; ver
  "Web mobile" abaixo.
- `packages/domain` — lógica pura (matching, auto-apply, receivables, regras,
  datas, dinheiro). Sem I/O, testável isolado.
- `packages/statements` — parsers de importação. `universal/` roda em
  browser+Node (OFX, CSV, NFS-e XML); `node/` precisa de Node (PDF via
  `unpdf`) e por isso fica fora do bundle mobile.
- `packages/db` — cliente Supabase tipado, `database.types.ts` (gerado),
  `types.ts` (aliases + labels + `hasRole`).
- `packages/ui` — design system (shadcn + tema TweakCN próprio).

Banco: Supabase/Postgres. **RLS é a única autoridade de acesso real** — toda
checagem de papel no código React/Server Action é só conveniência de UI
(esconder botão que não adiantaria mostrar); se checagem de app e RLS
discordarem, RLS ganha. Hierarquia de papel:
`cliente_leitura < assistente < contador < owner` (`app.has_role`/`app.role_rank`
no SQL, `hasRole`/`ROLE_LABELS` em `packages/db/src/types.ts`).

## Convenções estabelecidas (siga estas, não invente novas)

- **Migrations**: `supabase/migrations/YYYYMMDDHHMMSS_nome.sql`, sempre
  crescente. Nunca editar uma migration já aplicada em produção — sempre uma
  nova.
- **RPCs** (SECURITY INVOKER, `set search_path = public, pg_temp`): validam
  tudo com `raise exception` de mensagem clara em português ANTES de escrever
  — nunca deixar RLS falhar "por baixo" com mensagem genérica.
- **Auto-aplicação em lote** (`autoApplyReconciliation`, `autoApplyReceivables`):
  sempre um LOOP de chamadas RPC atômicas independentes, nunca uma transação
  SQL envolvente — uma linha ruim no meio não pode desfazer o que já foi
  aplicado antes dela. Sempre com um bucket `failed`/`errors` — nada some em
  silêncio.
- **Confiança binária**: `exact`/`likely` (matching) ou `matched`/`suggested`
  (receivables) — nunca inventar um terceiro nível "meio confiante".
- **Depois de qualquer mudança de schema**: regenerar tipos via
  `packages/db/scripts/dev-db.sh` + `generate-types.mjs`, rodar
  `pnpm exec prettier --write packages/db/src/database.types.ts`, e rodar
  `tests/sql/run.sh` com um bloco novo de teste provando RLS/travas da RPC.
- **Antes de commitar**: `pnpm turbo run type-check lint test build --force`.
  Reverter `packages/statements/tests/fixtures/extrato-cora-linhas.json` se
  ele regenerar sozinho ao rodar os testes (ruído, não é uma mudança real).
- **Postgres neste sandbox recusa rodar como root** — sempre
  `su postgres -c '...'` para `tests/sql/run.sh` e `dev-db.sh`. Matar
  processos `postgres` travados de execuções anteriores antes de tentar de
  novo (porta já em uso).
- **Commits**: Conventional Commits, `subject-case` minúsculo depois do
  prefixo, sempre com escopo (`feat(web): ...`, nunca `feat: ...` — o
  commitlint deste repo exige escopo não-vazio).

## Gotchas de Postgres/RLS descobertos nesta sessão

- `SELECT ... FOR UPDATE` sob RLS exige que a linha satisfaça a policy de
  **UPDATE**, não só a de SELECT — um lock é tratado como escrita. Isso deu
  uma mensagem enganosa numa RPC; a correção foi tirar o `FOR UPDATE`.
- Um `grant ... on all tables in schema public` só alcança tabelas que já
  existiam quando a migration rodou — toda tabela nova precisa de GRANT
  explícito, senão toda RLS nela é irrelevante (nega antes de avaliar RLS).
- `transactions` nunca ganhou um unique `(id, company_id)` — toda FK composta
  que apontaria para ela usa FK simples por `id`, com o `company_id` conferido
  na própria RPC.

## Funcionalidades — o que já existe e funciona

### Conciliação bancária (núcleo original)

Importa extrato (OFX/CSV/PDF do Cora), casa com lançamentos existentes ou cria
novo lançamento (`create_transaction_from_line`), aprende regras de
categorização (`matching_rules`), fecha/reabre mês
(`close_month`/`reopen_month`), auditoria completa.

### Modo simples (`memberships.simple_mode`)

Uma tela única (`/inicio`): sobe o extrato → o sistema tenta resolver tudo
sozinho (`autoApplyReconciliation`) → só sobra o que realmente precisa de
decisão humana (pareamento "provável", linha sem categoria). Toda escolha
manual de categoria já cria a regra de aprendizado automaticamente (sem
checkbox — diferente da tela avançada). `requireAdvancedAccess()` esconde as
telas avançadas de quem está em modo simples; `requireCompany()` continua
valendo pras 4 exceções deliberadas: Início, Faturamento, Recebimentos
(tarefa do dia a dia, não "avançado"), Regras (ver abaixo) e Equipe (é a
ÚNICA tela que desliga o modo simples — sem ela visível, um owner que ligasse
o modo simples em si mesmo ficaria trancado para sempre).

- **`/regras`** (nova rota, não faz parte de `simpleNav()` nem do `NAV`
  avançado — alcançada por um link a partir do card "Status do mes" em
  `/inicio`, não uma aba): antes, quem estava em modo simples não tinha
  NENHUMA forma de ver ou desligar uma regra automática ruim depois que ela
  saía do "último lançamento da sessão" (o único undo que `/inicio` oferece)
  — precisava pedir pro owner desligar o modo simples primeiro só pra chegar
  em `/cadastros`. Reaproveita `listMatchingRules`/`desativarRegra` que já
  existiam; a lista em si foi extraída de `cadastros-client.tsx` para
  `cadastros/regras-list.tsx`, usada pelas duas telas.

### Faturamento / Recebimentos (feature grande desta sessão)

Importa XML de NFS-e (`packages/statements/src/universal/nfse.ts`), casa o
recebimento (que pode vir de qualquer banco, com retenção de imposto, ou um
PIX quitando várias notas de uma vez) via `packages/domain/src/receivables.ts`

- RPC `settle_invoices`/`unsettle_invoice`. Validado contra um XML real de
  Salvador/BA — duas descobertas importantes:

* O arquivo real é um **lote** com dezenas de notas
  (`ConsultarNfseResposta > ListaNfse > CompNfse[]`), não uma nota por arquivo
  — `parseNfse` devolve `{ invoices, errors }`, nunca uma nota só.
* O arquivo real vem em **ISO-8859-1**, não UTF-8 — `decodeInvoiceXml` lê o
  encoding declarado no prolog antes de decodificar (senão nome de cliente
  com acento vira mojibake).

`autoApplyReceivables` (`apps/web/lib/db/faturamento.ts`) agora tem o bucket
`failed`/`errors` que a convenção de auto-aplicação exige — não tinha antes
(uma alocação recusada pela RPC só "ficava sem aplicar" em silêncio,
quebrando a própria convenção deste arquivo). Aparece em `/recebimentos`
(card "Não processado", com "Tentar de novo") e como um aviso curto no card
de recebimentos de `/inicio`.

### PWA / ícones

`app/icon.tsx`, `app/apple-icon.tsx`, `app/icons/{192,512}`, `app/manifest.ts`
— wordmark "aec" gerado via `next/og` (satori não lê woff2, a fonte é TTF).
`InstallHint` em `/inicio` avisa como adicionar à tela inicial (iOS vs
Android).

### Web mobile (substitui a Fase F — ver "Fases do projeto")

Não existe app nativo. A estratégia é **um único `apps/web` que também é bom
no celular**, instalável como PWA. Correções já aplicadas nesta leva:

- `CONTROL` em `packages/ui/src/components/form-fields.tsx` (usado por
  `Field`/`Input`/`Select`/`Textarea` — **todo** formulário do sistema) era
  `text-sm` (14px). Abaixo de 16px o Safari do iPhone dá zoom automático ao
  focar o campo. Virou `text-base sm:text-sm` — 16px no celular, volta a 14px
  a partir do breakpoint `sm` (desktop mantém a densidade original).
- O menu avançado (`[companyId]/layout.tsx`) tem 9 itens numa lista sem
  quebra nem rolagem — estourava ou espremia em qualquer tela de celular.
  Ganhou `overflow-x-auto` + `flex-nowrap`, o mesmo padrão que as tabelas
  largas do sistema já usavam.
- Duas tabelas (`contas/contas-client.tsx`, `painel/page.tsx`, duas dentro
  desta) não tinham o `overflow-x-auto` que `lancamentos`, `faturamento` e
  `relatorios` já tinham — a rolagem horizontal vazava pra página inteira.
  Ganharam o wrapper que faltava.
- **Alvo de toque dos botões `sm`** (`packages/ui/src/components/button.tsx`):
  eram ~28px de altura. Mesmo padrão do `CONTROL` acima — `px-3 py-3 text-sm`
  no celular (~44px), volta a `px-2.5 py-1.5 text-xs` a partir de `sm:`. Os
  dois `<button>` avulsos de `lancamentos/acoes-lancamento.tsx` (não passam
  pelo componente `Button`) ganharam o mesmo tratamento à mão (padding +
  margem negativa, revertido em `sm:`).
- **Menu avançado no celular**: as 9 telas agora têm um menu dedicado — uma
  barra de abas fixa no rodapé (`[companyId]/mobile-tab-bar.tsx`, ícones
  `lucide-react`) com Painel/Lançamentos/Conciliação/Faturamento fixos + uma
  aba "Mais" abrindo as 5 restantes (Recebimentos, Contas, Relatórios,
  Cadastros, Equipe) numa folha inferior. Só abaixo de `md:` — o `<nav>`
  horizontal original continua intacto em telas maiores. Modo simples (3-4
  itens) não ganhou barra: já cabe numa linha só.

Pendente para a próxima sessão (não bloqueante, ver "Pendências reais"):
nenhuma tela foi testada de verdade num aparelho — esta leva verificou a
barra de abas e os botões via print em Chromium headless (não dá pra logar
de verdade neste sandbox, sem `docker`/Supabase local), o que pega mais bug
visual do que só ler código, mas ainda não é a mesma coisa que um aparelho de
verdade com dados reais.

### Melhorias de workflow (última leva desta sessão)

- **Status do mês** em `/inicio`: último extrato importado + notas vencidas.
- **Desfazer lançamento** no modo simples: RPC `undo_transaction_from_line` +
  botão "Desfazer" — reverte o lançamento E desativa a regra automática
  criada junto, pra um erro de dedo não continuar se aplicando sozinho todo
  mês.
- **Aviso de nota vencida**: outstanding > 0 e emitida há mais de 45 dias (a
  NFS-e não declara vencimento — 45 dias é folga além do "mês seguinte" que a
  usuária descreveu).
- **`friendlyError()`** (`apps/web/lib/ui/format.ts`): garante que um erro
  técnico cru de Postgres/driver nunca seja a única coisa mostrada na tela.

### Consolidação de status disperso (item 1 do backlog filosófico, esta leva)

- **Alerta de caixa negativo em `/inicio`**: até esta leva só existia em
  `/painel` — quem usa modo simples (a persona do dia a dia) nunca vê
  `/painel`, então o aviso mais importante do sistema ("o caixa fica negativo
  em tal dia") não chegava a ela. Agora `/inicio` roda a mesma projeção
  (`project()` de `packages/domain`, mesmo horizonte de 30 dias, mesmas duas
  consultas — saldo consolidado + previstos) e mostra o mesmo `Alert`
  `tone="error"` que `/painel` já tinha. Melhor esforço: se qualquer uma das
  duas consultas falhar, o card simplesmente não aparece — não derruba a
  tela.
- **Mês fechado/aberto em `/painel`**: antes só aparecia em `/lancamentos`;
  quem usa o modo avançado não sabia sem navegar até lá. `/painel` agora
  consulta `monthly_closings` do mês corrente e mostra o mesmo aviso, com
  link para `/lancamentos` do mês.
- **Contagem de não conciliados**: não virou um número único (seria inventar
  comportamento novo) — os três lugares medem populações genuinamente
  diferentes (`/painel`/`/contas` contam `transactions` sem conciliar via
  `v_account_balances.unreconciled_count`; `/conciliacao` mostra essa MESMA
  contagem lado a lado com `statement_lines` pendentes, uma população
  diferente — linha de extrato que ainda não virou lançamento nem foi
  casada). O que estava faltando era clareza: o aviso de `/painel` virou link
  para `/conciliacao` e passou a citar as duas contagens separadamente em
  vez de só uma ("N lançamento(s) sem conciliar; M linha(s) do extrato
  aguardando tratamento"), então não existe mais um número que pareça
  divergir do que a pessoa vê ao clicar.

### Checagem de papel explícita em RPCs (item 2 do backlog filosófico, esta leva)

`close_month`, `reopen_month` e `settle_invoices` dependiam só de RLS pra
barrar quem não tem papel suficiente — a mensagem que subia nesse caso era o
erro genérico do Postgres ("new row violates row-level security policy..."),
quebrando a convenção deste arquivo (RPC valida com mensagem clara ANTES de
escrever). `20250101001700_role_checks_rpc.sql` redefine as três com
`app.has_role(...)` como a PRIMEIRA linha da função (mesmo padrão de
`add_member`) — RLS continua sendo a autoridade real, isto só garante a
mensagem certa chegando primeiro. `tests/sql/10_schema_test.sql` ganhou
testes de negação pra cada uma (assistente barrado em `close_month`,
cliente_leitura barrado em `reopen_month`; o teste de `settle_invoices` já
existia, só o comentário foi atualizado).

## Fases do projeto — o que falta

Todas as fases planejadas foram concluídas ou encerradas por decisão.

- **Fase F — app nativo (Expo)**: **encerrada por decisão do usuário em
  2026-08-27**, não por falta de tempo. Chegou a existir um esqueleto Expo
  commitado (`apps/mobile`: login, dashboard, lançamento rápido) — foi
  removido nesta sessão. Motivo: o app nunca teria entregue uma capacidade
  que o PWA do `apps/web` não entrega; o esforço real estava em arrumar a
  camada de escrita presa em Server Actions, não em ter um segundo app. A
  decisão foi trocar a Fase F por deixar **o próprio `apps/web` excelente no
  celular** — ver "Web mobile" acima. Se um app nativo voltar à mesa um dia,
  o ponto de partida é o histórico do git antes desta remoção, não do zero.

Concluídas: Fases A–E (esqueleto do monorepo, domínio puro, design system,
app web, conciliação), Fluxo Simples (5 fases: schema/session, domínio
auto-apply, rota `/inicio`, navegação, controle do owner), Faturamento (5
fases: schema, parser NFS-e, domínio receivables, Server Actions, telas) e a
validação do parser contra XML real.

## Pendências reais

- **Web mobile**: alvo de toque e menu dedicado (barra de abas) já feitos —
  ver seção acima. Falta só testar de verdade num aparelho; este sandbox não
  tem `docker` (`docker ps` falha), então não dá pra subir Supabase local e
  logar de verdade pra verificar as telas autenticadas ao vivo.
- **Backlog filosófico (tarefa aberta no task tracker)**: próximos updates
  devem continuar puxando da mesma linha — reler o que já existe, perguntar o
  que a usuária final sente falta no dia a dia, priorizar (1) consolidar
  status disperso, (2) fechar brechas de segurança/reversibilidade em
  automações que já existem, (3) só depois expandir escopo com feature nova.
  Feito até agora: regras de categorização visíveis/desligáveis em modo
  simples (`/regras`), `autoApplyReceivables` com bucket `failed`, alerta de
  caixa negativo e mês fechado consolidados (ver "Consolidação de status
  disperso" e "Checagem de papel explícita em RPCs" acima — `close_month`/
  `reopen_month`/`settle_invoices` já saíram da lista de pendências de (2)).
  Candidatos que sobraram de (2), pra quando chegar a vez de novo: a trilha
  `audit_log` existe no banco mas não tem NENHUMA tela que a exponha, nem pra
  quem já tem papel `contador`+ que a RLS permite ler; várias tabelas
  (`matching_rules`, `statement_lines`, `statement_imports`, `categories`,
  `counterparties`, `cost_centers`) não têm trigger de auditoria; não existe
  ação de UI pra cancelar uma nota fiscal já importada por engano (RLS
  permite, mas nenhum botão chama).
- Toda migration nova precisa ser colada manualmente pelo usuário no SQL
  Editor do Supabase em produção — este sandbox não tem acesso ao banco real.
  A migration mais recente (`20250101001700_role_checks_rpc.sql`) **ainda não
  foi aplicada** pelo usuário — a anterior
  (`20250101001600_undo_transaction_from_line.sql`) já foi.
- O parser de NFS-e foi validado contra UM município real (Salvador/BA,
  ABRASF v1). Um XML de outra prefeitura pode expor variações de layout ainda
  não cobertas pelos sinônimos de tag em `nfse.ts`.

## Branch

Todo trabalho vai em `claude/accounting-bank-control-platform-b7drpl`, com
push direto (sem PR, a menos que pedido explicitamente).
