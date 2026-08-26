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
  em produção.
- `apps/mobile` — Expo, **ainda não iniciado** (Fase F, pendente há muito
  tempo, baixa prioridade).
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
valendo pras 3 exceções deliberadas: Início, Faturamento, Recebimentos (tarefa
do dia a dia, não "avançado") e Equipe (é a ÚNICA tela que desliga o modo
simples — sem ela visível, um owner que ligasse o modo simples em si mesmo
ficaria trancado para sempre).

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

### PWA / ícones

`app/icon.tsx`, `app/apple-icon.tsx`, `app/icons/{192,512}`, `app/manifest.ts`
— wordmark "aec" gerado via `next/og` (satori não lê woff2, a fonte é TTF).
`InstallHint` em `/inicio` avisa como adicionar à tela inicial (iOS vs
Android).

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

## Pendências reais

- **`apps/mobile` (Fase F)**: não iniciado. Baixa prioridade, sem pedido
  recente do usuário.
- **Backlog filosófico (tarefa aberta no task tracker)**: próximos updates
  devem continuar puxando da mesma linha — reler o que já existe, perguntar o
  que a usuária final sente falta no dia a dia, priorizar (1) consolidar
  status disperso, (2) fechar brechas de segurança/reversibilidade em
  automações que já existem, (3) só depois expandir escopo com feature nova.
- Toda migration nova precisa ser colada manualmente pelo usuário no SQL
  Editor do Supabase em produção — este sandbox não tem acesso ao banco real.
  A migration mais recente (`20250101001600_undo_transaction_from_line.sql`)
  **já foi aplicada** pelo usuário.
- O parser de NFS-e foi validado contra UM município real (Salvador/BA,
  ABRASF v1). Um XML de outra prefeitura pode expor variações de layout ainda
  não cobertas pelos sinônimos de tag em `nfse.ts`.

## Branch

Todo trabalho vai em `claude/accounting-bank-control-platform-b7drpl`, com
push direto (sem PR, a menos que pedido explicitamente).
