# AEC — Controle Bancário / Contábil

Plataforma de conciliação bancária e faturamento para um escritório de
contabilidade (nome real: AEC Assessoria Empresarial e Contábil, Salvador/BA).
Dono do projeto: Lucas (lucasbccanuto@gmail.com). Usuária final do dia a dia:
sua sogra, que opera a contabilidade da empresa.

Este arquivo é o resumo de estado do projeto — escrito para sobreviver a um
`/clear` de contexto. Leia antes de continuar qualquer trabalho aqui.

Lucas normalmente programa pelo iPad ou iPhone — sem terminal/editor de
arquivo à mão pra abrir o repo direto. Qualquer coisa que ele precise copiar
(uma migration pra colar no SQL Editor do Supabase, um trecho de SQL/config)
tem que vir no corpo da mensagem, pronta pra copiar — nunca só "está no
arquivo X" ou um caminho de arquivo sem o conteúdo junto.

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
  nova. **Sempre mandar o SQL completo da migration no corpo da mensagem**
  (não só o caminho do arquivo) assim que ela for criada/alterada — é assim
  que o Lucas cola no SQL Editor do Supabase em produção, do iPad/iPhone.
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

## Gotcha de Next.js descoberto nesta sessão

Server Action com corpo grande (o PDF do Cora vai inteiro em base64 pro
servidor, ~33% maior que o arquivo — `unpdf` só roda em Node, não dá pra
parsear no navegador) **estourava o limite padrão de 1mb do Next antes da
própria função rodar** — o `try/catch` de dentro da Server Action nunca
chegava a executar, e o cliente via um erro cru do React (minificado, tipo
"#441") em vez da mensagem amigável que
`parsePdfStatement` já devolve pra PDF inválido ou de outro banco.
`experimental.serverActions.bodySizeLimit` em `next.config.ts` resolve — mas
qualquer Server Action nova que receba arquivo binário grande (base64,
upload) precisa lembrar do mesmo limite, e do mesmo padrão de recusar
client-side ANTES de tentar enviar (`parse-file.ts`), não só confiar que o
`catch` do lado do servidor vai pegar.

## Funcionalidades — o que já existe e funciona

### Conciliação bancária (núcleo original)

Importa extrato (OFX, CSV ou PDF do Cora), casa com lançamentos existentes ou
cria novo lançamento (`create_transaction_from_line`), aprende regras de
categorização (`matching_rules`), fecha/reabre mês
(`close_month`/`reopen_month`), auditoria completa.

**OFX e CSV já funcionam pra qualquer banco** — Cora, Bradesco, Caixa, o que
for (`packages/statements/src/universal/`, roda no navegador, sem parser
específico por banco). **PDF, hoje, só entende o layout do Cora**
(`packages/statements/src/node/cora.ts`) — não é uma limitação proposital
contra outros bancos, é que só existe leitor pra um layout até agora, e um
leitor de PDF por banco só pode ser construído (com segurança pra dado
financeiro) contra uma amostra real daquele banco, validada com um teste que
soma tudo e bate contra o saldo declarado — exatamente como o Cora foi
validado (ver `packages/statements/tests/local/README.md`).

Descoberta desta sessão, testando um PDF real da Caixa (enviado pelo
WhatsApp): o PDF não tinha NENHUM texto — `pdfinfo`/`pdftotext` (poppler) e
`unpdf` (o motor que o sistema usa) concordam nisso, e a estrutura interna do
arquivo confirma por quê — cada página é uma imagem JPEG embutida
(`/Subtype /Image`, `/Filter /DCTDecode`) dentro de um PDF montado por
`pdfmake`, não texto de verdade. Um leitor por posição de texto (a técnica
que o Cora usa) **não tem como ler esse arquivo**, de nenhum banco — não é
questão de escrever mais regex, é que não há texto ali pra ler. A alternativa
seria OCR (imagem → texto), que é uma tecnologia bem mais arriscada pra dado
financeiro (erra dígito) e não está implementada. Se um dia aparecer um PDF
de Caixa/Bradesco/outro banco com texto selecionável de verdade (confirma
tentando marcar/copiar o texto num leitor de PDF comum), um leitor dedicado
pra esse banco pode ser construído do mesmo jeito rigoroso que o do Cora.

A tela avançada (`/conciliacao`) já roda `autoApplyReconciliation` — o mesmo
domínio que o modo simples usa — logo depois de importar o extrato, e
também expõe um botão "Aplicar automaticamente" pra reaplicar em qualquer
momento (útil pra um backlog de linhas de uma importação anterior). Antes,
essa tela nunca chamava auto-apply: toda linha, mesmo pareamento exato ou
regra já aprendida com categoria, esperava um clique manual de
"Confirmar"/"Criar lançamento" uma por uma. Só continua manual o que o
sistema genuinamente não tem certeza (sugestão fraca, linha sem categoria) —
mesmo corte de confiança do modo simples.

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

### Reforma de UI/UX — "A Esteira" (major update, Fase 1 completa)

Motivada por uma queixa direta do dono do projeto: a usabilidade estava
inaceitável e a usuária final — contadora com 30 anos de mercado, sua sogra —
não estava conseguindo se adaptar, mesmo com "boa estrutura" por baixo. Nas
palavras dele, faltava "entrar num fordismo, numa cadeia de produção" ao
abrir o app.

Diagnóstico (duas varreduras completas desta leva: jornada das 11 telas +
inventário do design system): o app era organizado por tabela do banco, não
por tarefa do contador. Defeitos concretos: `/painel` era a aterrissagem
padrão sem UM botão sequer; `/inicio` renderizava um paredão de 30 decisões
de uma vez em vez de uma fila; o motivo do pareamento
(`packages/domain/src/matching.ts`, `describe()`) saía em inglês; datas cruas
em ISO em `/conciliacao`; `/recebimentos` escrevia no banco
(`autoApplyReceivables`) sozinho ao montar a tela, sem pedir; regra de
categorização nascia em silêncio; zero infraestrutura de feedback
(`loading.tsx`/`error.tsx`, toast, skeleton — nenhum existia).

Decisões tomadas com o usuário: redesenhar também o visual (não só
comportamento); unificar `simpleMode` numa interface só (Fase 2, ainda não
feita); entregar em fases, começando pelo fluxo do dia a dia. Dois pedidos
diretos da usuária entraram no escopo: "subperfis"/lentes de análise por
ramo do negócio (Fase 2a, ainda não feita — depende de confirmar se todas as
contas estão numa única empresa) e "não consigo lembrar do que se refere
aquele valor" (Fase 1d, feita nesta leva).

**Fase 1 (o fluxo do dia a dia) está completa — 1a a 1e:**

- **1a — fundação do design system**: `@radix-ui/react-*` (Dialog, Tabs,
  Tooltip, Checkbox, Switch, Popover) entram em `packages/ui`, cumprindo o
  que o design system sempre alegou usar ("shadcn + TweakCN") e nunca tinha
  instalado. Componentes novos: `Dialog`/`ConfirmDialog` (substitui o
  `confirm()` cru do navegador), `Toast`/`ToastProvider`, `Stepper`,
  `Skeleton`, `Spinner` (+ `Button` com prop `loading`), `PageHeader`,
  `StatTile`, `DataTable`, `Tooltip`, `Tabs`, `Checkbox`, `Switch`,
  `ThemeToggle`. Refresh de `theme.css`: superfícies mais claras e neutras,
  `--radius` maior, tokens de sombra novos — e o **dark mode**, que já
  estava 100% definido em CSS desde a primeira leva e nunca tinha sido
  ligado, agora liga via `next-themes` (`app/providers.tsx`) com um toggle no
  cabeçalho. `loading.tsx`/`error.tsx` chegaram a toda rota — antes, toda
  navegação era uma tela em branco enquanto 6-8 queries resolviam no
  servidor.
- **1b — tela "Hoje" (`/[companyId]/hoje`)**: nova aterrissagem única,
  substituindo `/painel` e `/inicio` — `app/page.tsx` e
  `requireCompany()` redirecionam pra lá agora, independente de
  `simpleMode`. Mostra a esteira do mês num `Stepper` (Extrato → Revisar →
  Notas → Conferir → Fechar, cada estágio com estado), uma única próxima
  ação em destaque (upload de extrato, ir revisar, ou "tudo em dia, pode
  fechar"), e os mesmos avisos que `/painel` já tinha (caixa negativo, notas
  vencidas, mês fechado) — mesma consulta, mesma resposta, não duas versões
  divergentes.
- **1c — fila de revisão (`/[companyId]/revisar`)**: o fordismo literal.
  Troca o paredão de N decisões simultâneas por **um item por vez, em tela
  cheia**, com contador de progresso (`3 de 17`), o lançamento candidato
  lado a lado com o motivo do pareamento em português, atalhos de teclado no
  desktop (`Enter` confirma, `→` pula), e aviso explícito antes de criar
  regra automática (checkbox ligada por padrão mas visível e desligável —
  antes isso acontecia em silêncio). Nenhuma lógica de negócio nova: é uma
  casca de apresentação sobre `matchStatement`/`categorize`
  (`packages/domain`) e as Server Actions que `/conciliacao` já usava.
- **1d — painel de detalhe do lançamento (esta leva)**: pedido direto da
  usuária. `statement_lines.memo` — o histórico original que o banco manda
  ("pix pra fulano"), ligado por `matched_transaction_id` — aparece agora em
  `Tooltip` ao passar o mouse no valor de `/lancamentos`, e num `Dialog`
  completo ao clicar (documento, categoria, conta, situação, forma de
  pagamento). `transactions.notes` — campo livre que existia desde a
  primeira leva e nenhuma tela jamais expunha — vira editável nesse mesmo
  painel, via a nova Server Action `atualizarObservacoes`
  (`apps/web/lib/db/transactions.ts`). `apps/web/app/(app)/[companyId]/lancamentos/page.tsx`
  busca o memo de todos os lançamentos do mês numa única query em lote
  (`statement_lines.matched_transaction_id IN (...)`), não uma por linha da
  tabela.
- **1e — correções de conteúdo que a fila expôs**: `describe()`
  (`packages/domain/src/matching.ts`) traduzido para português — o motivo do
  pareamento saía literalmente em inglês ("same amount, 3 days apart...");
  `formatDate` aplicado a todas as datas de `/conciliacao` (estavam em ISO
  cru); `/recebimentos` parou de rodar `autoApplyReceivables` sozinho ao
  montar a tela — agora precisa de um clique explícito ("Buscar e organizar
  recebimentos") antes de dar baixa em qualquer nota.

**Fase 2a — perfis de contas (lentes gerenciais), completa nesta leva.**
Segundo pedido direto da usuária: agrupar contas bancárias sob um nome
("Serviços por fora", "Contábil empresarial") e ver o app filtrado por essa
lente — uma, várias, ou todas de uma vez. Confirmado com o dono do projeto
que hoje todas as contas estão numa única empresa, então a fase seguiu o
desenho original (perfil como filtro N:N sobre `bank_accounts`, não uma
segunda fronteira de empresa).

- **Schema** (`20250101001800_account_profiles.sql`): `account_profiles` +
  `account_profile_accounts` (N:N — a mesma conta pode estar em mais de um
  perfil), RLS leitura para qualquer membro / escrita a partir de
  `contador`, no mesmo padrão de `bank_accounts`. Nome `AccountProfile` no
  lado TS para não colidir com a tabela `profiles` que já existe (espelho
  de `auth.users`). Duas RPCs SECURITY INVOKER (`create_account_profile`,
  `set_account_profile_accounts`) fazem a escrita composta (perfil+vínculo,
  ou trocar o conjunto de contas) numa transação só — diferente de
  `accounts.ts`/`cadastros.ts`, que escrevem direto na tabela porque lá é
  sempre uma linha só.
- **Bug corrigido em `generate-types.mjs`**: um argumento de RPC do tipo
  array (`uuid[]`) virava `string` no tipo gerado — nenhuma RPC anterior
  deste projeto tinha argumento array pra expor isso antes das duas acima.
- **Seletor global** (`PerfilSelector`, no cabeçalho de toda tela avançada):
  multi-seleção, "Todos os perfis" marcado por padrão, escolha vive em
  `?perfil=` (compartilhável, sobrevive a refresh) via
  `apps/web/lib/ui/account-profiles.ts` (`resolvePerfilSelecao`). Só
  aparece quando a empresa já tem algum perfil cadastrado. `Popover` novo
  em `packages/ui` para isso — o Radix já era dependência desde a Fase 1a,
  faltava o wrapper.
- **Gestão dos perfis**: card novo em `/contas` (criar, editar contas,
  renomear, arquivar — soft delete como categorias/contrapartes). Fica
  junto de Contas por ora; muda pra "Ajustes" quando a Fase 2b criar essa
  tela.
- **Filtro aplicado** em `/lancamentos`, `/conciliacao`, `/relatorios` e
  `/painel`: quando há perfil selecionado e nenhum filtro de conta única
  mais específico já escolhido na própria tela, só entram
  lançamentos/linhas/saldos das contas daquela lente. Fechamento de mês e
  NFS-e continuam por empresa, de propósito — perfil é lente de leitura,
  não uma segunda fronteira. `/hoje` ainda não foi filtrada por perfil
  (mostra o estado do ciclo mensal da empresa inteira, não uma métrica
  quebrada por conta) — candidato a revisitar se a usuária pedir.

**Pendente do plano geral** (próximas levas — ver "Pendências reais"): Fase
2b (unificar `simpleMode` numa interface só e a navegação), Fase 3
(vocabulário/microcopy — "pareamento" → "correspondência", etc.), Fase 4
(assistente de primeiro uso + seed de categorias em `create_company`), Fase
5 (relatório por categoria, centro de custo/contraparte, transferência
entre contas, cancelar nota importada por engano, paginação). O plano
completo com todo o levantamento vive só na conversa — não há arquivo de
plano versionado no repo.

### Revisão noturna de bugs (madrugada de 28/08/2026, sem supervisão)

Lucas pediu uma rotina automática pra revisar e corrigir bugs sozinho até
as 06h enquanto ele dormia (sem construir feature nova, sem tocar a Fase
2b). Rodou de hora em hora via `code-review --fix`, cobrindo o diff inteiro
desta sessão e depois cada pacote isolado; 5 commits (`7c61751`, `befb673`,
`d9d0844`, `30c6402`, `2c45de3`), pipeline completo verde em todos. Achados
reais corrigidos:

- **`[companyId]/layout.tsx`**: `listAccountProfiles()` sem guarda
  derrubava toda página da empresa (o layout não tem `error.tsx` próprio)
  se a query falhasse — o caso óbvio sendo a migration de perfis, ainda não
  aplicada em produção. Agora degrada: sem perfis, o seletor só fica
  oculto.
- **`painel/page.tsx`**: a contagem de linhas de extrato pendentes não
  respeitava o filtro de perfil selecionado, enquanto a contagem ao lado
  (`aConciliar`) respeitava — reintroduzia a divergência que a seção
  "Consolidação de status disperso" registra como resolvida.
- **`hoje/page.tsx`**: `canWrite` era sempre `true` (checagem morta —
  já tinha um early-return antes que garantia isso), então `cliente_leitura`
  via CTA de escrita ("Fechar o mês") em vez do aviso de só-consulta que
  `/revisar` e `/lancamentos` já mostram pro mesmo papel.
- **`packages/domain/balance.ts`**: `dailyBalances()` zerava o saldo
  inicial quando a janela pedida começa na (ou antes da) data de abertura
  da conta — `balanceOn(..., previousDay(start))` retorna 0 para qualquer
  data anterior à abertura. Sem nenhuma tela chamando ainda, mas ia
  aparecer assim que o gráfico de evolução (que o docstring já promete)
  fosse ligado.
- **`packages/domain/receivables.ts`**: a busca de PIX agrupado
  (`subsetsSummingTo`) era força bruta 2^n sem teto — um cliente com
  dezenas de notas em aberto travaria a Server Action por segundos, e a
  partir de 31 notas o deslocamento de bits de 32 bits do JS estoura.
  Teto de 24, mesmo padrão de guarda que `BankingCalendar`/
  `expandRecurrence` já usam.
- **`packages/statements/nfse.ts`**: `parseNfseAmount` era uma cópia de
  `parseOfxAmount` que perdeu o strip do `+` explícito — um valor tipo
  "+150,00" num campo de retenção derrubava a nota inteira. Extraído pra
  um `parseTolerantAmount` compartilhado (`universal/amount.ts`), usado
  pelos dois parsers agora.
- **`generate-types.mjs`**: um tipo array de enum virava
  `"a" | "b" | "c"[]` (array só no último membro da união, não da união
  inteira) — dormant até agora, mas a migration de perfis desta mesma
  leva foi o primeiro argumento de RPC array do projeto a acender esse
  caminho.
- **`packages/ui/dialog.tsx`**: `ConfirmDialog` fechava antes de uma
  `onConfirm` assíncrona (Server Action) terminar — qualquer erro dela
  nunca aparecia em lugar nenhum. Agora espera resolver, com spinner/
  desabilitado nos botões enquanto pendente.
- **`packages/ui/toast.tsx`**: o timer de auto-dismiss nunca era limpo no
  fechamento manual nem no unmount do provider.

Achado sinalizado mas **não corrigido de propósito** (fora do escopo de
correção de bug): `DataTable`/`PageHeader`/`StatTile`, adicionados na Fase
1a, ainda não são usados em nenhuma tela de `apps/web` — a duplicação de
`<table>` que deveriam substituir continua existindo. Candidato pra Fase
2b/3, não pra uma correção pontual.

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

- **Reforma de UI/UX — Fases 2b a 5**: Fase 1 (fluxo do dia a dia) e Fase 2a
  (perfis de contas) estão completas, ver seção acima. Falta: Fase 2b
  (unificar `simpleMode` numa interface só e a navegação), Fase 3
  (vocabulário/microcopy), Fase 4 (assistente de primeiro uso + seed de
  categorias em `create_company`), Fase 5 (relatório por categoria, centro
  de custo/contraparte, transferência entre contas, cancelar nota importada
  por engano, paginação).
- **`DataTable`/`PageHeader`/`StatTile`** (`packages/ui`, Fase 1a) existem e
  são exportados, mas nenhuma tela de `apps/web` os usa ainda — achado pela
  revisão noturna de 28/08, ver seção acima. A duplicação de `<table>`/
  cabeçalho que eles deveriam substituir continua espalhada em ~5 telas.
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
  A migration mais recente (`20250101001800_account_profiles.sql`) **ainda
  não foi aplicada** — ver o corpo da mensagem que a introduziu para o SQL
  completo.
- O parser de NFS-e foi validado contra UM município real (Salvador/BA,
  ABRASF v1). Um XML de outra prefeitura pode expor variações de layout ainda
  não cobertas pelos sinônimos de tag em `nfse.ts`.
- **PDF de banco além do Cora**: o escritório usa vários bancos (Bradesco,
  Caixa, etc.), e OFX/CSV já cobrem qualquer um deles — só PDF é Cora-only
  hoje (ver "Conciliação bancária" acima pro porquê e o que destrava um
  leitor novo). Pendente: usuário vai tentar exportar OFX da Caixa pelo
  internet banking (Extrato → Exportar/Download → formato OFX, às vezes
  rotulado "Money") como caminho imediato; se algum banco só oferecer PDF
  com texto de verdade (não imagem, como o testado nesta sessão), mandar uma
  amostra pra construir o leitor dedicado.

## Branch

Todo trabalho vai em `claude/accounting-bank-control-platform-b7drpl`, com
push direto (sem PR, a menos que pedido explicitamente).
