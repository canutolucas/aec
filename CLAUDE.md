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
  renomear, arquivar — soft delete como categorias/contrapartes). Desde a
  Fase 2b, `/contas` já é uma sub-aba do grupo Ajustes — não precisou mover.
- **Filtro aplicado** em `/lancamentos`, `/conciliacao`, `/relatorios` e
  `/painel`: quando há perfil selecionado e nenhum filtro de conta única
  mais específico já escolhido na própria tela, só entram
  lançamentos/linhas/saldos das contas daquela lente. Fechamento de mês e
  NFS-e continuam por empresa, de propósito — perfil é lente de leitura,
  não uma segunda fronteira. `/hoje` ainda não foi filtrada por perfil
  (mostra o estado do ciclo mensal da empresa inteira, não uma métrica
  quebrada por conta) — candidato a revisitar se a usuária pedir.

**Fase 2b — unificar os modos e a navegação, completa.** Antes, `simpleMode`
produzia duas interfaces (`NAV`/`simpleNav()` em `layout.tsx`) e
`requireAdvancedAccess()` expulsava quem estava em modo simples de 7 das 11
telas — a persona real (a sogra do dono do projeto) não tinha como abrir
Contas, Cadastros ou Regras sem pedir pra alguém desligar o modo simples
nela primeiro.

- **`apps/web/lib/ui/nav-groups.ts`** (novo): uma navegação só. 9-11 itens
  viram 5 grupos — Hoje sozinho, e Movimentos/Notas/Relatórios/Ajustes cada
  um com sub-abas (`NAV_GROUPS`). `simpleMode` deixa de ser portão de tela e
  vira só densidade: dentro de Ajustes, esconde a sub-aba Cadastros
  (categorias/contrapartes/centros de custo — "engenharia" da contabilidade,
  não o dia a dia). Contas e Regras continuam sempre visíveis; Equipe
  continua só para `owner` — é a única tela que desliga o modo simples,
  então precisa continuar alcançável por quem está nele.
- **`requireAdvancedAccess()`** (`apps/web/lib/db/session.ts`) virou um
  alias puro de `requireCompany()` — mantido pelo nome/documentação nos
  call sites, não barra mais nada por `simpleMode`.
- **`SubNav`** (`apps/web/app/(app)/[companyId]/sub-nav.tsx`, novo): a casca
  de abas em si, inserida em 11 `page.tsx` — nenhuma tela teve lógica
  alterada, só ganhou a barra de navegação por cima.
- **`MobileTabBar`** reescrita: 5 abas fixas (Hoje/Movimentos/Notas/
  Relatórios/Ajustes) via `topLevelNav()`, sempre visível agora (antes só
  aparecia fora do modo simples) — a folha "Mais" foi removida, não faz mais
  falta com só 5 itens de topo.
- 28 testes novos (`nav-groups.test.ts`) cobrindo a matriz papel×simpleMode
  de visibilidade por grupo.

**Fase 3 — vocabulário e microcopy, completa.** Preservado o vocabulário
contábil real ("conciliação", "lançamento", "previsto/realizado", "centro de
custo" — termos legítimos de 30 anos de profissão); trocado o jargão de
software: "pareamento" → "correspondência" em toda a UI (`inicio-client.tsx`,
`conciliacao-client.tsx`, `revisar-client.tsx`, `hoje/page.tsx`), "Aplicar
automaticamente" → "Organizar o que dá sozinho", "memo" → "histórico do
banco", "Contrapartes" → "Clientes e fornecedores", acentuação corrigida em
menus/títulos que estavam inconsistentes desde a primeira leva (inclusive
`ROLE_LABELS.owner`: "Responsavel" → "Responsável"). `/equipe` ganhou
`ROLE_DESCRICOES` explicando o que cada papel pode fazer (antes escolhia-se
no escuro); `/faturamento` ganhou um `Tooltip` explicando de onde vêm os "45
dias" de nota vencida. **Deliberadamente não tocado**: mensagens de
`raise exception` no SQL — são um estilo uniforme desde a primeira migration,
e corrigir cosmética ali custaria várias migrations novas só por acentuação.

**Fase 4 — primeiro uso, completa.**

- **Migration** `20250101002000_seed_categories_on_create_company.sql`
  redefine `create_company` (via `create or replace function`, a migration
  original nunca é editada) semeando 9 categorias — 2 de entrada (Vendas e
  serviços, Outras receitas), 7 de saída (Fornecedores, Salários e encargos,
  Impostos e taxas, Aluguel, Despesas administrativas, Tarifas bancárias,
  Outras despesas). Antes, empresa nova nascia sem nenhuma categoria: em
  modo simples o `Select` ficava vazio, o botão "Lancar" ficava
  permanentemente desabilitado, e nada na tela explicava por quê —
  beco sem saída, porque `/cadastros` (onde daria pra criar uma categoria)
  era inalcançável em modo simples antes da Fase 2b. **Esta migration ainda
  não foi aplicada em produção** — SQL completo abaixo.
- Assistente de primeira vez dedicado foi descartado: a esteira de `/hoje`
  (Fase 1b) já cumpre esse papel de orientar "o que fazer agora".
- Dois becos sem saída fechados: `EmptyState` de "nenhuma conta" em
  `/conciliacao` ganhou botão pra `/contas`; `EmptyState` de "nenhuma regra"
  em `/regras`/`/cadastros` ganhou botão pra `/conciliacao` — achados numa
  auditoria completa dos ~13 `EmptyState` do app.

**Fase 5 — promessas quebradas, completa.**

- **Cancelar nota fiscal importada por engano**: `cancelarNota`
  (`apps/web/lib/db/faturamento.ts`) — só permite quando
  `v_invoice_balances.received_amount` é zero (uma nota com baixa registrada
  precisa desfazer a baixa primeiro, mesmo raciocínio de
  `undo_transaction_from_line`). Botão "Cancelar" por linha em
  `/faturamento`, atrás de um `ConfirmDialog`.
- **Centro de custo / contraparte no lançamento rápido**:
  `criarLancamento` já aceitava `counterpartyId`, mas nenhuma tela
  preenchia; ganhou `costCenterId` também. `LancamentoRapido` ganhou os dois
  `Select` (só aparecem se a empresa tiver cadastro correspondente).
- **Transferência entre contas**: `criarTransferencia` já existia em
  `lib/db/transactions.ts` e nenhuma tela chamava — a badge "transferencia"
  aparecia na tabela sem que fosse possível produzi-la. `TransferenciaDialog`
  (novo) em `/lancamentos`.
- **Relatório por categoria** (`/relatorio-categorias`, novo, nova aba em
  Relatórios): consulta `v_monthly_category_summary` — a view já existia com
  `grant`, nunca tinha sido consultada por nenhuma tela. Só `realizado`
  (mesmo recorte que `/painel` usa pros totais do mês); agrupa em Entradas/
  Saídas com "Sem categoria" como um grupo à parte (LEFT JOIN da view).
  **Não filtra por perfil de conta** — decisão deliberada: a view agrega por
  categoria, não por conta, não tem `bank_account_id` pra filtrar sem mudar
  a view.
- **Limites silenciosos de `/conciliacao` tornados visíveis**: as consultas
  sempre tiveram um teto (500 linhas de extrato pendentes, 2.000
  lançamentos não conciliados) que nunca era comunicado — um `Alert`
  aparece quando o teto é atingido, avisando que os itens mais antigos podem
  não estar na lista. **Não é paginação de verdade** (mudaria a tela
  inteira, que hoje trabalha com o array completo em memória para
  pareamento/correspondência e prova de saldo) — é o mínimo que fecha a
  promessa quebrada: avisar, não esconder.

O plano completo de todas as 5 fases (levantamento, decisões, tabela de
vocabulário) vive só na conversa — não há arquivo de plano versionado no
repo.

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
2b/3, não pra uma correção pontual. (`/auditoria`, nesta mesma leva, é a
primeira tela do sistema a usar os três — as ~5 telas antigas com `<table>`
duplicada continuam como estavam; migrá-las é trabalho separado, cosmético,
sem urgência.)

### Trilha de auditoria completa (item 2 do backlog filosófico, retomado)

`app.write_audit_log()` e a tabela `audit_log` existem desde a primeira
leva (RLS já liberava leitura a partir de `contador`), mas duas lacunas
sobravam: seis tabelas nunca tiveam o trigger ligado, e nenhuma tela jamais
consultava a trilha — nem quem já tinha permissão pra ler tinha onde ver.

- **`20250101002100_audit_triggers_restantes.sql`**: liga
  `app.write_audit_log()` (o mesmo trigger já em produção desde a primeira
  leva, nada novo) em `categories`, `counterparties`, `cost_centers`,
  `matching_rules`, `statement_imports`, `statement_lines` — a lista exata
  que já estava documentada aqui como pendência — e também em
  `account_profiles`/`account_profile_accounts` (Fase 2a, que nasceu depois
  da trilha existir e ficou de fora pelo mesmo motivo). Teste novo em
  `tests/sql/10_schema_test.sql` prova que renomear uma categoria agora
  grava a trilha, do mesmo jeito que `transactions` já provava.
- **`/auditoria`** (nova rota, nova aba em Relatórios, `minRole: "contador"`
  — a mesma régua que a RLS já usa, então a aba nem aparece pra quem nunca
  conseguiria ver nada nela): lista as alterações do mês (filtro por mês +
  por tabela), com "Ver detalhes" abrindo o diff campo a campo entre
  `old_data`/`new_data` (`updated_at` excluído do diff, mesmo critério que o
  trigger já usa pra não gravar UPDATE que não mudou nada). `changed_by`
  vira nome via uma consulta em lote em `profiles` (mesmo padrão do memo de
  extrato em `/lancamentos`); `null` (só ocorre se `auth.uid()` era nulo no
  momento da escrita — fora do fluxo normal do app) aparece como "Fora do
  app". Mesmo padrão de teto visível da Fase 5: até 500 linhas por consulta,
  com aviso se bater no teto.
- **Limitação aceita e documentada no próprio código**: o filtro por mês
  compara `changed_at` (timestamptz) contra a data crua, o que assume meia-
  noite UTC em vez de meia-noite de Brasília — um registro dos primeiros ou
  últimos instantes do mês pode aparecer no mês vizinho. Não afeta saldo nem
  fechamento (é só uma tela de consulta), e nenhuma outra tela do sistema
  ainda tinha filtrado por timestamptz para haver um padrão exato a seguir.

### A leva do dia a dia — corrigir, dar baixa direito, previstos (madrugada de 01/09/2026)

Depois da Reforma "A Esteira" e da trilha de auditoria, uma varredura
completa desta sessão (schema × código, domínio × UI, telas × fluxo do
contador) expôs que o app **cria** dado financeiro muito bem e **corrige**
muito mal: não existia edição de lançamento, a baixa de previsto não aceitava
a data nem o valor que caíram de verdade, cadastro desativado por engano
sumia para sempre, e o previsto vencido de um mês desaparecia ao olhar outro
mês (a única tela de previstos era `/lancamentos`, filtrada por mês). Três
desses eram becos sem saída literais: o sistema mandava a pessoa fazer algo
que não existia em tela nenhuma (`atualizarObservacoes` sem edição de mais
nada; `cancelarNota`/`undo_transaction_from_line` mandando "desfaça a baixa
em Recebimentos" sem essa ação existir). Lucas escolheu os itens do dia a
dia da usuária final entre 15 candidatos levantados: editar lançamento
existente, desfazer baixa de nota fiscal, dar baixa com data/valor reais,
editar/reativar cadastros + ativar/desativar conta, e uma tela de previstos
sem filtro de mês. Decisão de trava tomada com ele: lançamento conciliado ou
com baixa de nota trava só **valor, data e conta** (os três que sustentam a
prova de saldo e o rateio da nota) — categoria, descrição, cliente, centro
de custo, documento e observações continuam editáveis sempre.

Três bugs vivos fechados nesta leva (nomeados A1/A2/A3 no diagnóstico):

- **A1 — `settle_transaction` mentia quando o RLS recusava.** Terminava com
  `update ... returning * into v_row` sem `if not found`; em mês fechado a
  policy recusa em silêncio (`transactions_update` usa `using` sobre a data
  ANTIGA do lançamento), `v_row` vira nulo, a função "tinha sucesso" sem
  nada ter mudado. Fechado em duas camadas: a Server Action (`darBaixa`)
  passou a conferir `data?.id`, e a migration desta leva (abaixo) deu à
  própria função o `if not found` que faltava.
- **A2 — `atualizarObservacoes`/`unsettleInvoiceAction` tinham o mesmo
  buraco.** Nenhuma checava linhas afetadas. `atualizarObservacoes` foi
  fundida em `editarLancamento` (abaixo); `unsettleInvoiceAction` ganhou
  pré-checagem por id + pós-checagem relendo a linha.
- **A3 — `excluirLancamento` apagava baixa de nota por cascata, sem
  recalcular a nota.** `invoice_settlements.transaction_id` é
  `on delete cascade`; `undo_transaction_from_line` já guardava esse caso
  com `raise exception`, `excluirLancamento` não guardava nada. Agora recusa
  com a mesma frase quando existe `invoice_settlements` para o lançamento.

**`packages/domain/src/transaction-edits.ts`** (novo): `editLocks()` e
`canSettle()`/`canUnsettle()`, puras — a mesma função decide o que a tela
desabilita (com motivo explicado) e o que o servidor recusa
(`editarLancamento`), o mesmo princípio que `hasRole`/RLS já aplicam em
outro lugar deste repo. **`packages/domain/src/planned.ts`**:
`splitPlanned()` — bucket de previstos em vencido/a vencer × entrada/saída,
mesmo corte de data que `/painel` já usava (`bookingDate === hoje` conta
como "a vencer").

**Baixa de previsto com data e valor reais**: `darBaixa` deixou de ser só
"marcar como realizado" — aceita a data em que o dinheiro andou e o valor
que de fato caiu, **sempre derivando o sinal do lado do servidor** a partir
do previsto original (nunca do que a pessoa digitou — um valor positivo
digitado num previsto de saída não pode virar receita e inverter o
resultado do mês). `desfazerBaixa` (nova) volta um realizado para previsto,
para desfazer um erro de baixa ou "lancei como realizado e o dinheiro ainda
não caiu" — trava por `canUnsettle()` (conciliado, baixa de nota,
transferência e mês fechado bloqueiam, com mensagem por motivo).
`lancamentos/baixa-dialog.tsx` (novo) hospeda os dois modos, com diff ao
vivo ("Previsto era R$ 1.000,00 em 05/03 — está registrando R$ 1.012,30 em
08/03").

**Editar lançamento existente** (nunca existiu antes desta leva):
`editarLancamento` (`apps/web/lib/db/transactions.ts`) recalcula as travas
no servidor com `editLocks()` e recusa explicitamente se o pedido mexe num
campo travado — desabilitar na tela é conveniência, a recusa real é aqui.
Sentido (sinal) e situação (previsto/realizado) nunca são editáveis por
este caminho — trocar sinal é excluir e relançar; situação tem o caminho
próprio de `darBaixa`/`desfazerBaixa`. `lancamentos/editar-lancamento-form.tsx`
(novo) explica cada campo travado numa frase ("Valor e data vieram do
extrato do banco. Para corrigir, desfaça a conciliação primeiro").

**`/previstos`** (nova rota, nova sub-aba em Movimentos, entre Lançamentos e
Conciliação): a diferença central é **não ter filtro de mês** — consulta
todo `status = 'previsto'` ordenado por vencimento, teto de 500 linhas com
o `Alert` de teto visível que a Fase 5 já padronizou. Duas abas (A pagar/A
receber) via `splitPlanned()`, cada uma com Vencidos (destacado, "há N
dias") e A vencer. Reusa `AcoesLancamento`/`DetalheLancamento` de
`/lancamentos` sem duplicar lógica — é só uma fatia diferente do mesmo
dado. `/painel` teve seus links de "previsto vencido" redirecionados para
cá — antes apontavam para `/lancamentos` filtrado por mês, onde o vencido
de outro mês não aparecia.

**Baixas de nota fiscal visíveis e reversíveis**: `cancelarNota` e
`undo_transaction_from_line` sempre mandaram "desfaça a baixa em
Recebimentos primeiro", e essa ação não existia em tela nenhuma até esta
leva. `faturamento/baixas-da-nota.tsx` (novo, `BaixasDaNota`) lista cada
baixa de uma nota (valor, data, lançamento de origem) com "Desfazer" atrás
de `ConfirmDialog`; entra nos dois lugares que a mensagem menciona —
`/faturamento` (onde a pessoa esbarra no bloqueio de "Cancelar" quando já
tem recebimento — vira "Ver baixas") e `/recebimentos` (card "Baixas
registradas", só leitura + desfazer, sem tocar no clique explícito que
`autoApplyReceivables` já exige desde a Fase 1e).

**Editar e reativar cadastros, ativar/desativar conta**: até esta leva,
"desativar" categoria/centro de custo/contraparte/conta era porta só de
ida — sem edição, sem reativar, sem ver o que estava inativo sem consultar
o banco. As três `desativar*()` também não checavam linhas afetadas (mesmo
buraco do A2: um assistente clicando "Desativar" numa categoria via
sucesso com nada escrito, porque `categories_write` exige contador).
Viraram pares `editar*`/`definir*Ativa(o)` em `apps/web/lib/db/cadastros.ts`
e `definirContaAtiva` em `accounts.ts` (separada de `editarConta` de
propósito — um toggle de linha não deve arrastar saldo inicial junto).
`editarCategoria` conta lançamentos no sentido oposto antes de restringir o
`kind` de "ambos" para "entrada"/"saída" (o trigger de schema só valida a
própria transaction, nunca a categoria mudando por baixo dela).
`cadastros-client.tsx` ganhou `?inativos=1` (sobrevive a refresh, como
`?perfil=`/`?mes=`), edição inline e "Reativar"; `contas-client.tsx` ganhou
Desativar/Reativar com aviso explícito no confirm — desativar tira a conta
do formulário de lançamento e da importação, **mas o saldo dela continua
entrando no consolidado**.

**Migration desta leva (ainda não aplicada em produção — ver "Pendências
reais")**: `20250101002200_settle_transaction_guards.sql`, um
`create or replace` de `settle_transaction` que fecha o A1 (`if not found`
depois do UPDATE) e um risco maior nunca travado: a função nunca validava o
**sinal** de `p_amount` — um valor positivo informado para a baixa de um
previsto de saída (ou negativo para um de entrada) inverte o lançamento e o
resultado do mês inteiro, sem aviso. O app já deriva o sinal do lado do
servidor e nunca confia no que a pessoa digitou, mas a função SQL é a
autoridade real — nada impedia uma chamada direta à RPC com o sinal
errado. Não muda a assinatura da função (confirmado regenerando
`database.types.ts` — diff vazio depois do `prettier --write`), não precisa
tocar nenhum call site. `tests/sql/10_schema_test.sql` tem os dois casos:
mês fechado agora recusa com mensagem clara em vez de devolver linha nula,
e um valor de sinal errado é recusado.

### A leva da carteira — conta nova, base limpa e o cérebro da contadora (01/09/2026)

Lucas pediu três coisas com a sogra indisponível (ela cuida do financeiro de
várias empresas — inclusive da própria empresa dela — e o pedido foi
literalmente "simule o cérebro dela"): limpar a base de teste para a
experiência de primeiro uso, habilitar o cadastro de conta (até então
impossível — `/login` só sabia entrar, `add_member` recusa quem ainda não
tem login), e uma varredura do sistema como se fosse ela avaliando.

**Diagnóstico** (contra o código, não palpite): a carteira não existia como
conceito — `/empresas` era só uma lista de nomes com botão "Abrir", sem um
número sequer, mesmo o schema sendo multiempresa desde a primeira migration.
A esteira de `/hoje` ancorava sempre no mês corrente — em 1º de setembro ela
está fechando agosto, e o app já mandava "suba o extrato de setembro" no
dia 2. O passo "Extrato" só testava se existia _qualquer_ importação no mês,
não se o extrato cobria o mês inteiro. Não havia calendário de fechamento —
`monthly_closings` só era consultado um mês por vez, em três telas
diferentes. A prova de saldo (`checkBalance`) já existia, mas só em
`/conciliacao` — o fechamento não perguntava "o saldo bate?". `recurrences`
e `expandRecurrence()` estavam prontos e testados desde a primeira leva de
schema e nunca tinham sido ligados a nenhuma tela. Nenhum relatório
comparava meses, e `v_monthly_category_summary` sempre expôs
`period_accrual` (competência) ao lado de `period_cash`, sem nenhuma tela
consultando a segunda coluna.

- **Cadastro de conta e recuperação de senha**: `apps/web/app/(auth)/cadastrar`,
  `esqueci-senha`, `nova-senha` e a rota `apps/web/app/auth/callback` (troca
  o `code` do link de e-mail pela sessão real, fluxo PKCE). `full_name` vai
  em `raw_user_meta_data` — é o que `on_auth_user_created` lê pra popular
  `public.profiles`. `apps/web/lib/db/site-url.ts` monta o link do e-mail
  lendo o host da própria requisição, sem variável de ambiente nova.
  **Passo manual do Lucas**: em Authentication → URL Configuration no painel
  do Supabase, o Site URL e as Redirect URLs precisam incluir o domínio da
  Vercel + `/auth/callback` — sem isso o link do e-mail volta pra
  `localhost`.
- **Carteira de empresas**: `/empresas` vira um painel com uma linha por
  empresa — saldo consolidado, contas sem extrato do mês, movimentos sem
  revisar, lançamentos sem conciliar, notas vencidas/a receber, mês
  fechado/aberto — ordenada por quem precisa de atenção primeiro. 6
  consultas com `.in("company_id", ids)`, agrupadas em JS: não cresce com o
  número de empresas. Com mais de uma empresa, `/` aterrissa ali em vez de
  `companies[0]` (a mais antiga, arbitrária).
- **`packages/domain/src/monthly-cycle.ts`**: `workingMonth()` decide em que
  mês a contadora está de fato trabalhando (o anterior, enquanto não
  fechado); `canCloseMonth()` recusa um mês que ainda não terminou;
  `statementCoverage()` distingue "teve alguma importação no mês" de
  "o extrato alcança o FIM do mês". `apps/web/lib/db/prova-de-saldo.ts`
  extrai o cálculo de `checkBalance` de `/conciliacao` para ser reusado.
- **A esteira no mês certo + `/fechamentos`**: `/hoje` usa `workingMonth()`
  com um seletor de mês (`?mes=`) que sempre volta pro automático; o passo
  Extrato usa `statementCoverage()`; o passo Conferir incorpora a prova de
  saldo; o passo Fechar usa `canCloseMonth()` — um mês em curso não vira um
  CTA de "feche" vazio. `/fechamentos` (nova rota, 5ª sub-aba de
  Movimentos) é o calendário dos últimos 12 meses, reusando `FechamentoMes`
  sem alterá-lo.
- **Recorrências**: `apps/web/lib/db/recorrencias.ts` liga a tabela
  `recurrences` e `expandRecurrence()` — `criarRecorrencia`/
  `editarRecorrencia`/`definirRecorrenciaAtiva` (com a mesma checagem de
  zero-linhas-afetadas que `cadastros.ts` já estabeleceu) e
  `gerarPrevistos`, que segue a convenção de auto-aplicação deste repo: um
  INSERT independente por ocorrência, bucket `criados`/`jaExistiam`/
  `falharam` explícito, `generated_until` como guarda contra duplicata.
  `/recorrencias` (nova rota, 5ª sub-aba de Ajustes, escondida no modo
  simples) tem o cadastro e o botão "Gerar previstos agora" — clique
  explícito, nada escreve sozinho ao abrir a tela.
- **Evolução mensal e competência**: `/evolucao` (nova rota, sub-aba de
  Relatórios) mostra os últimos 12 meses — entradas, saídas, resultado,
  saldo ao fim de cada um — reusando `project()` (o mesmo motor de
  `/relatorios`) sobre a janela inteira, em vez de recalcular saldo mês a
  mês na mão. `/relatorio-categorias` ganha o alternador "Por caixa / Por
  competência", trocando `period_cash` por `period_accrual` no filtro.

Nenhuma migration nesta leva — as seis mudanças só ligam schema e views que
já existiam. A limpeza da base (para a experiência de primeiro uso) foi só
SQL entregue no corpo da mensagem (`truncate ... cascade` em `companies`,
mantendo `auth.users`/`profiles`), não um commit.

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
fases: schema, parser NFS-e, domínio receivables, Server Actions, telas), a
validação do parser contra XML real, e a Reforma de UI/UX "A Esteira"
completa (Fases 1a–1e, 2a, 2b, 3, 4, 5 — ver seção acima).

## Pendências reais

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
  `reopen_month`/`settle_invoices` já saíram da lista de pendências de (2)),
  cancelar nota fiscal importada por engano (Fase 5), e a trilha de
  auditoria — trigger nas tabelas que faltavam + tela `/auditoria` pra
  quem já tinha permissão de ler e não tinha onde ver (ver seção acima).
  Não sobrou nenhum candidato de (2) documentado no momento; a próxima
  leva decide se continua nessa linha ou avança pra (3).
- Toda migration nova precisa ser colada manualmente pelo usuário no SQL
  Editor do Supabase em produção — este sandbox não tem acesso ao banco real.
  `20250101001800_account_profiles.sql` (Fase 2a),
  `20250101002000_seed_categories_on_create_company.sql` (Fase 4),
  `20250101002100_audit_triggers_restantes.sql` (trilha de auditoria) e
  `20250101002200_settle_transaction_guards.sql` (leva do dia a dia,
  01/09/2026) foram todas aplicadas. Nenhuma migration pendente no momento
  — a leva da carteira (mesma data, ver seção acima) não precisou de
  nenhuma.
- **Passo manual pendente da leva da carteira**: em Authentication → URL
  Configuration no painel do Supabase, cadastrar o Site URL e as Redirect
  URLs com o domínio da Vercel + `/auth/callback` — sem isso o link de
  confirmação de cadastro e o de redefinição de senha voltam pra
  `localhost` em vez do domínio real.
- O parser de NFS-e foi validado contra UM município real (Salvador/BA,
  ABRASF v1). Um XML de outra prefeitura pode expor variações de layout ainda
  não cobertas pelos sinônimos de tag em `nfse.ts`.
- **PDF de banco além do Cora — confirmado que vai ser necessário** (Lucas,
  29/08): o escritório vai mandar extratos de outros bancos além do Cora,
  em PDF, OFX e CSV. OFX/CSV **já funcionam pra qualquer banco hoje**
  (`packages/statements/src/universal/`) — nada a construir aí, é só
  importar quando chegar. **PDF continua Cora-only** — ver "Conciliação
  bancária" acima pro porquê (leitor por posição de texto, só existe pro
  layout do Cora) e o que destrava um leitor novo: uma amostra real do PDF
  de cada banco, com texto de verdade e selecionável (não imagem escaneada
  — confirma tentando marcar/copiar o texto num leitor comum antes de
  mandar). Assim que uma amostra chegar, o leitor dedicado desse banco é o
  próximo passo natural, seguindo o mesmo rigor de validação do Cora (soma
  tudo, bate contra o saldo declarado).

## Branch

Todo trabalho vai em `claude/accounting-bank-control-platform-b7drpl`, com
push direto (sem PR, a menos que pedido explicitamente).
