# Controle Bancario

Plataforma para uma assessoria contabil controlar as entradas e saidas das
contas bancarias de seus clientes, alimentada diariamente e conciliada com o
extrato do banco. Substitui a planilha de Excel usada hoje.

O que a planilha nao faz e esta aqui:

- **Trava de mes fechado.** Depois de fechado, o mes nao aceita mais escrita. A
  reabertura exige motivo e fica registrada com autor e data.
- **Conciliacao com o extrato.** Importa OFX ou CSV do banco e aponta, linha a
  linha, o que falta lancar e o que foi lancado mas nao aconteceu.
- **Trilha de auditoria.** Quem alterou, quando, e de quanto para quanto.
- **Fluxo de caixa projetado.** A data exata em que o caixa fura, se furar.
- **Isolamento entre empresas.** Aplicado no banco por RLS, nao por filtro no
  codigo da aplicacao.

## Estado atual

| Fase | Escopo | Situacao |
|---|---|---|
| 0 | Fundacao, schema, RLS, autenticacao | pronto |
| 1 | Contas bancarias, lancamentos, saldo, transferencia | pronto |
| 2 | Conciliacao bancaria | dominio e leitores prontos; telas pendentes |
| 3 | Fluxo de caixa projetado | dominio pronto; usado no painel |
| 4 | Relatorios, dashboard, fechamento pela tela | pendente |
| 5 | Migracao da planilha e carteira multiempresa | modelo pronto; telas pendentes |

O schema ja e multiempresa desde o primeiro dia. Habilitar a carteira e
configuracao, nao refatoracao.

## Como rodar

Precisa de Node 22 e do [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start          # sobe Postgres, Auth e Storage locais
cp .env.example .env.local
# preencha NEXT_PUBLIC_SUPABASE_ANON_KEY com a chave que o `supabase start` imprimiu
npm run db:reset        # aplica as migrations e os dados de exemplo
npm run dev
```

Abra http://localhost:3000 e entre com um dos usuarios de exemplo (senha
`senha-de-teste-123`):

| E-mail | Papel | Para que serve |
|---|---|---|
| `responsavel@assessoria.teste` | Responsavel | acesso total, duas empresas |
| `assistente@assessoria.teste` | Assistente | lanca e concilia, nao fecha o mes |
| `cliente@empresa-a.teste` | Cliente | somente leitura, uma empresa |

Entrar com dois deles em janelas separadas e a forma mais rapida de ver o
isolamento entre empresas e as permissoes por papel funcionando.

## Verificacao

```bash
npm run check      # typecheck, lint e testes de dominio e importacao
npm run test:sql   # schema, RLS, trava de mes e seeds, em Postgres puro
```

`npm run test:sql` **nao precisa de Docker nem do Supabase CLI**: sobe um
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

## Como o codigo esta organizado

```
app/                    telas (Next.js App Router)
lib/domain/             REGRAS PURAS, sem I/O — toda conta de dinheiro
lib/import/             leitores de OFX e CSV -> formato canonico unico
lib/db/                 acesso ao Supabase e Server Actions
supabase/migrations/    schema versionado
tests/sql/              testes de schema, RLS e seeds
```

### Tres regras que valem para o repositorio inteiro

**1. Conta de dinheiro so mora em `lib/domain/`.** Sao funcoes puras, sem I/O e
sem relogio, e sao as unicas que somam valores. Repetir a mesma soma em SQL e em
TypeScript garante que as duas versoes divirjam com o tempo.

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

A aplicacao nunca usa a *service role* do Supabase: toda consulta e feita
autenticada como a pessoa que esta usando o sistema. Um cliente com service role
atravessaria o RLS e tornaria todas as policies decorativas.

As checagens de papel na interface servem para esconder o que a pessoa nao pode
fazer — botao que so devolve erro e uma cortesia ruim. Elas **nao sao** o
controle de acesso: se a interface e o banco discordarem, quem vale e o banco.

Como sao dados financeiros de terceiros, o MFA esta habilitado e a auto-inscricao
esta desligada: usuarios sao criados por quem administra.
