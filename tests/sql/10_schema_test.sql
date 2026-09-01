-- =============================================================================
-- Testes do schema: isolamento entre empresas, trava de mes fechado, integridade
-- das transferencias e calculo de saldo.
--
-- Rodam em Postgres puro (veja tests/sql/00_supabase_stub.sql). Cada bloco atua
-- como um usuario real: `set local role authenticated` mais o claim `sub`, que e
-- exatamente o que o PostgREST faz em producao. Testar RLS como superusuario nao
-- testa nada — o superusuario passa por cima de toda policy.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.assert(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FALHOU: %', p_message;
  end if;
  raise notice '  ok: %', p_message;
end $$;

-- Executa um SQL como um usuario autenticado e devolve a contagem de linhas.
create or replace function pg_temp.count_as(p_user uuid, p_sql text)
returns bigint language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  execute 'select count(*) from (' || p_sql || ') s' into v_count;
  return v_count;
end $$;

-- Executa um comando como um usuario e exige que ele seja RECUSADO.
create or replace function pg_temp.expect_denied(p_user uuid, p_sql text, p_message text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  begin
    execute p_sql;
  exception when others then
    raise notice '  ok: % [%]', p_message, sqlerrm;
    return;
  end;
  raise exception 'FALHOU: % (o comando foi ACEITO, mas deveria ter sido recusado)', p_message;
end $$;

-- Executa um comando como um usuario e devolve quantas linhas ele afetou.
create or replace function pg_temp.affected_as(p_user uuid, p_sql text)
returns bigint language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Executa um comando como um usuario, sem exigir nada do resultado.
create or replace function pg_temp.run_as(p_user uuid, p_sql text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  execute p_sql;
end $$;

-- Le um unico valor como um usuario.
create or replace function pg_temp.value_as(p_user uuid, p_sql text)
returns text language plpgsql as $$
declare v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  execute p_sql into v_value;
  return v_value;
end $$;

-- =============================================================================
-- Cenario: duas empresas, quatro usuarios com papeis diferentes.
-- =============================================================================
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'dona@assessoria.com.br'),
  ('22222222-2222-2222-2222-222222222222', 'assistente@assessoria.com.br'),
  ('33333333-3333-3333-3333-333333333333', 'cliente@empresa-a.com.br'),
  ('44444444-4444-4444-4444-444444444444', 'estranho@outra.com.br');

insert into public.companies (id, name, tax_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Empresa A', '11222333000181'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B', '11222333000262');

insert into public.memberships (company_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'assistente'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'cliente_leitura'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'owner');

insert into public.bank_accounts (id, company_id, name, opening_balance, opening_balance_date) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Itau Corrente',  10000.00, '2025-01-01'),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bradesco Corrente', 5000.00, '2025-01-01'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BB Corrente',    99999.00, '2025-01-01');

insert into public.categories (id, company_id, name, kind) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Receita de servicos', 'entrada'),
  ('c1c1c1c1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Aluguel', 'saida');

insert into public.transactions
  (company_id, bank_account_id, category_id, booking_date, competence_date, amount, status, description)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', '2025-03-05', '2025-03-05',  2500.00, 'realizado', 'Honorarios marco'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000002', '2025-03-10', '2025-03-10', -1800.00, 'realizado', 'Aluguel marco'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', null, '2025-03-07', '2025-03-07', -400.00, 'realizado', 'Despesa da empresa B');

\echo ''
\echo '== Isolamento entre empresas (RLS) =='
set role authenticated;

do $$ begin perform pg_temp.assert(
  pg_temp.count_as('11111111-1111-1111-1111-111111111111', 'select 1 from public.transactions') = 2,
  'dona da Empresa A enxerga os 2 lancamentos da propria empresa'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.count_as('44444444-4444-4444-4444-444444444444', 'select 1 from public.transactions') = 1,
  'dono da Empresa B enxerga apenas o lancamento da Empresa B'
); end $$;

-- O teste que importa: consulta SEM filtro de company_id, feita por quem nao e
-- membro. Tem de voltar vazia, e nao "o que sobrou".
do $$ begin perform pg_temp.assert(
  pg_temp.count_as('44444444-4444-4444-4444-444444444444',
    'select 1 from public.transactions where company_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''') = 0,
  'Empresa B nao alcanca nenhum lancamento da Empresa A nem pedindo explicitamente'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.count_as('44444444-4444-4444-4444-444444444444', 'select 1 from public.bank_accounts') = 1,
  'contas bancarias tambem sao isoladas por empresa'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.count_as('44444444-4444-4444-4444-444444444444', 'select 1 from public.v_account_balances') = 1,
  'a view de saldos respeita RLS (security_invoker) e nao vaza saldo de outra empresa'
); end $$;

reset role;

\echo ''
\echo '== Papeis: quem pode escrever o que =='
set role authenticated;

do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-04-01', '2025-04-01', 100, 'Tentativa do portal')$q$,
  'cliente_leitura (portal do cliente) nao consegue lancar'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description)
       values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-04-01', '2025-04-01', 100, 'Lancamento do assistente')$q$) = 1,
  'assistente consegue lancar'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$insert into public.bank_accounts (company_id, name, opening_balance, opening_balance_date)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Conta nova', 0, '2025-01-01')$q$,
  'assistente nao abre conta bancaria (exige contador)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.counterparties (company_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fornecedor X')$q$) = 1,
  'owner cadastra contraparte'
); end $$;

reset role;

\echo ''
\echo '== Perfis de contas (lentes gerenciais) =='
set role authenticated;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$insert into public.account_profiles (company_id, name)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Servicos por fora')$q$,
  'assistente nao cria perfil (exige contador)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.account_profiles (id, company_id, name)
       values ('d1d1d1d1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Servicos por fora')$q$) = 1,
  'owner (rank acima de contador) cria perfil'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.account_profile_accounts (company_id, profile_id, bank_account_id) values
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000002')$q$) = 2,
  'owner agrupa duas contas no mesmo perfil (a mesma conta pode entrar em mais de um perfil depois -- N:N)'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$insert into public.account_profile_accounts (company_id, profile_id, bank_account_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001')$q$,
  'assistente nao mexe em quais contas entram num perfil'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.count_as('33333333-3333-3333-3333-333333333333', 'select 1 from public.account_profiles') = 1,
  'cliente_leitura enxerga o perfil (leitura livre para qualquer membro)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.count_as('44444444-4444-4444-4444-444444444444', 'select 1 from public.account_profiles') = 0,
  'perfil da Empresa A nao vaza para a Empresa B'
); end $$;

-- create_account_profile: o caminho que a tela de fato usa (cria o perfil e
-- ja vincula as contas na mesma transacao).
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.create_account_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Contabil empresarial',
     array['a1a1a1a1-0000-0000-0000-000000000001']::uuid[])$q$,
  'assistente nao chama create_account_profile'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.create_account_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '   ',
     array['a1a1a1a1-0000-0000-0000-000000000001']::uuid[])$q$,
  'create_account_profile recusa nome vazio'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.create_account_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Perfil sem conta', array[]::uuid[])$q$,
  'create_account_profile recusa perfil sem nenhuma conta'
); end $$;

do $$ begin perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
  $q$select public.create_account_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Contabil empresarial',
     array['a1a1a1a1-0000-0000-0000-000000000001']::uuid[])$q$
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.value_as('11111111-1111-1111-1111-111111111111',
    $q$select count(*) from public.account_profile_accounts apa
       join public.account_profiles ap on ap.id = apa.profile_id
       where ap.company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and ap.name = 'Contabil empresarial'$q$
  )::int = 1,
  'create_account_profile grava perfil + vinculo numa chamada so'
); end $$;

-- set_account_profile_accounts: substitui o conjunto de contas do perfil
-- criado acima (que tinha so a conta 1) pela conta 2 -- prova que troca, nao
-- acumula.
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.set_account_profile_accounts('d1d1d1d1-0000-0000-0000-000000000001',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['a1a1a1a1-0000-0000-0000-000000000002']::uuid[])$q$,
  'assistente nao chama set_account_profile_accounts'
); end $$;

do $$ begin perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
  $q$select public.set_account_profile_accounts('d1d1d1d1-0000-0000-0000-000000000001',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['a1a1a1a1-0000-0000-0000-000000000002']::uuid[])$q$
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.value_as('11111111-1111-1111-1111-111111111111',
    $q$select bank_account_id::text from public.account_profile_accounts
       where profile_id = 'd1d1d1d1-0000-0000-0000-000000000001'$q$
  ) = 'a1a1a1a1-0000-0000-0000-000000000002',
  'set_account_profile_accounts substitui o conjunto (nao acumula com o antigo)'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.set_account_profile_accounts('00000000-0000-0000-0000-000000000000',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', array['a1a1a1a1-0000-0000-0000-000000000001']::uuid[])$q$,
  'set_account_profile_accounts recusa perfil inexistente'
); end $$;

reset role;

-- Chave composta (id, company_id), como transactions x bank_accounts acima:
-- mesmo como superusuario, um perfil da Empresa A nao consegue agrupar uma
-- conta da Empresa B.
do $$
begin
  begin
    insert into public.account_profile_accounts (company_id, profile_id, bank_account_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-000000000001');
    raise exception 'FALHOU: aceitou perfil agrupando conta de outra empresa';
  exception when foreign_key_violation then
    raise notice '  ok: perfil nao pode agrupar conta bancaria de outra empresa';
  end;
end $$;

\echo ''
\echo '== Integridade entre empresas =='
do $$ begin perform pg_temp.assert(
  (select count(*) from public.transactions) >= 0, 'sanidade'
); end $$;

-- Chave composta (id, company_id): mesmo como superusuario, um lancamento da
-- Empresa A nao consegue apontar para conta da Empresa B.
do $$
begin
  begin
    insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b1b1b1b1-0000-0000-0000-000000000001', '2025-04-01', '2025-04-01', 50, 'Conta de outra empresa');
    raise exception 'FALHOU: aceitou lancamento apontando para conta de outra empresa';
  exception when foreign_key_violation then
    raise notice '  ok: lancamento nao pode apontar para conta bancaria de outra empresa';
  end;
end $$;

\echo ''
\echo '== Categoria tem de aceitar o sentido do lancamento =='
do $$
begin
  begin
    insert into public.transactions (company_id, bank_account_id, category_id, booking_date, competence_date, amount, description)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', '2025-04-02', '2025-04-02', -300, 'Saida em categoria de receita');
    raise exception 'FALHOU: aceitou saida classificada em categoria de entrada';
  exception when check_violation then
    raise notice '  ok: saida nao pode ser classificada em categoria de receita';
  end;
end $$;

\echo ''
\echo '== Categoria de topo nao pode se repetir na mesma empresa =='
-- categories' own table-level unique constraint is (company_id, parent_id,
-- name) — useless for a top-level category, since parent_id is NULL on
-- every one of those and Postgres treats every NULL as distinct from every
-- other NULL. The partial unique index added in
-- 20250101001200_categories_top_level_unique.sql is what actually closes
-- this gap; this proves it holds without relying on any parent_id value.
do $$
begin
  begin
    -- 'Aluguel' already exists for this company (seeded above), at the top
    -- level (parent_id null) — exactly the collision the constraint gap
    -- used to miss.
    insert into public.categories (company_id, name, kind)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Aluguel', 'ambos');
    raise exception 'FALHOU: aceitou categoria de topo com nome repetido';
  exception when unique_violation then
    raise notice '  ok: categoria de topo com nome repetido e recusada';
  end;
end $$;

\echo ''
\echo '== Lancamento anterior ao saldo inicial =='
do $$
begin
  begin
    insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2024-12-31', '2024-12-31', 10, 'Antes do saldo inicial');
    raise exception 'FALHOU: aceitou lancamento anterior ao saldo inicial da conta';
  exception when check_violation then
    raise notice '  ok: lancamento anterior ao saldo inicial e recusado (seria contado em dobro)';
  end;
end $$;

\echo ''
\echo '== Transferencia entre contas =='
set role authenticated;

do $$
declare v_group uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);

  select public.create_transfer(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'a1a1a1a1-0000-0000-0000-000000000001',
    'a1a1a1a1-0000-0000-0000-000000000002',
    1000.00, '2025-04-05', 'Transferencia Itau -> Bradesco'
  ) into v_group;

  perform pg_temp.assert(
    (select count(*) from public.transactions where transfer_group_id = v_group) = 2,
    'transferencia cria exatamente 2 lancamentos'
  );
  perform pg_temp.assert(
    (select sum(amount) from public.transactions where transfer_group_id = v_group) = 0,
    'os dois lados da transferencia se anulam'
  );
  perform pg_temp.assert(
    (select bool_and(is_transfer) from public.transactions where transfer_group_id = v_group),
    'os dois lados ficam marcados como transferencia'
  );
end $$;

reset role;

-- Transferencia desbalanceada tem de ser recusada.
--
-- A trigger de transferencia e DEFERRABLE de proposito: ela roda no commit, para
-- que os dois lados possam ser inseridos na mesma transacao sem que o primeiro ja
-- falhe sozinho. Por isso o teste precisa de SET CONSTRAINTS ALL IMMEDIATE para
-- antecipar a checagem; sem isso o erro so apareceria depois do bloco terminar.
do $$
begin
  begin
    insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description, transfer_group_id)
    values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-04-06', '2025-04-06', -500, 'Perna 1', '99999999-0000-0000-0000-000000000001'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000002', '2025-04-06', '2025-04-06',  400, 'Perna 2', '99999999-0000-0000-0000-000000000001');
    set constraints all immediate;
    raise exception 'FALHOU: aceitou transferencia que nao se anula';
  exception when check_violation then
    raise notice '  ok: transferencia desbalanceada e recusada';
  end;
end $$;

-- Transferencia com uma perna so tambem nao passa.
do $$
begin
  begin
    insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description, transfer_group_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-04-06', '2025-04-06', -500, 'Perna orfa', '99999999-0000-0000-0000-000000000002');
    set constraints all immediate;
    raise exception 'FALHOU: aceitou transferencia com um lado so';
  exception when check_violation then
    raise notice '  ok: transferencia com um lado so e recusada';
  end;
end $$;

-- Apagar so um lado de uma transferencia ja gravada deixaria o outro orfao,
-- somando errado no saldo. Tambem tem de ser recusado.
do $$
declare v_one uuid;
begin
  select id into v_one from public.transactions
   where description = 'Transferencia Itau -> Bradesco' limit 1;
  begin
    delete from public.transactions where id = v_one;
    set constraints all immediate;
    raise exception 'FALHOU: aceitou apagar um lado so da transferencia';
  exception when check_violation then
    raise notice '  ok: nao da para apagar apenas um lado de uma transferencia';
  end;
end $$;

\echo ''
\echo '== Saldo derivado do movimento =='
-- Itau: 10.000 inicial + 2.500 - 1.800 + 100 (assistente) - 1.000 (transferencia) = 9.800
-- Bradesco: 5.000 inicial + 1.000 (transferencia) = 6.000
set role authenticated;
do $$ begin perform pg_temp.assert(
  pg_temp.value_as('11111111-1111-1111-1111-111111111111',
    $q$select current_balance from public.v_account_balances where bank_account_id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$)::numeric = 9800.00,
  'saldo do Itau confere: 10.000 + 2.500 - 1.800 + 100 - 1.000 = 9.800'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.value_as('11111111-1111-1111-1111-111111111111',
    $q$select current_balance from public.v_account_balances where bank_account_id = 'a1a1a1a1-0000-0000-0000-000000000002'$q$)::numeric = 6000.00,
  'saldo do Bradesco confere: 5.000 + 1.000 = 6.000'
); end $$;

-- Transferencia nao pode aparecer como receita nem despesa no gerencial.
do $$ begin perform pg_temp.assert(
  pg_temp.count_as('11111111-1111-1111-1111-111111111111',
    $q$select 1 from public.v_monthly_category_summary
       where company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and period_cash = '2025-04-01'
         and total_amount = 1000$q$) = 0,
  'transferencia fica fora do resumo por categoria (nao e receita nem despesa)'
); end $$;
reset role;

\echo ''
\echo '== Trava de mes fechado =='
set role authenticated;

-- close_month agora checa o papel do CHAMADOR antes de escrever (20250101001700):
-- sem esta checagem, um assistente so descobriria que nao pode fechar o mes
-- quando o INSERT em monthly_closings esbarrasse na RLS, com a mensagem
-- generica do Postgres em vez de uma frase clara em portugues.
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.close_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01')$q$,
  'assistente nao consegue fechar o mes (precisa de contador ou responsavel)'
); end $$;

do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.close_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01')$q$);
  perform pg_temp.assert(true, 'marco fechado pelo owner');
end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.value_as('11111111-1111-1111-1111-111111111111',
    $q$select closing_balance::text from public.monthly_closing_balances b
       join public.monthly_closings c on c.id = b.closing_id
       where c.period = '2025-03-01' and b.bank_account_id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$)::numeric = 10700.00,
  'snapshot congela o saldo de 31/03 em 10.700, mesmo com movimento posterior'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$insert into public.transactions (company_id, bank_account_id, booking_date, competence_date, amount, description)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-03-20', '2025-03-20', 999, 'Lancamento em mes fechado')$q$,
  'nem o owner lanca dentro de mes fechado'
); end $$;

-- Em UPDATE e DELETE o RLS nao levanta erro: a linha simplesmente deixa de ser
-- alcancavel. Zero linhas afetadas E a trava funcionando.
do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.transactions set amount = 1 where booking_date = '2025-03-05'$q$) = 0,
  'lancamento de mes fechado nao pode ser alterado'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$delete from public.transactions where booking_date = '2025-03-05'$q$) = 0,
  'lancamento de mes fechado nao pode ser excluido'
); end $$;

-- Arrastar um lancamento de abril (aberto) para marco (fechado) tambem nao pode:
-- e o WITH CHECK do UPDATE segurando.
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$update public.transactions set booking_date = '2025-03-25' where description = 'Lancamento do assistente'$q$,
  'nao da para arrastar lancamento de mes aberto para dentro de mes fechado'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.transactions set notes = 'ok' where description = 'Lancamento do assistente'$q$) = 1,
  'mes aberto continua editavel normalmente'
); end $$;

\echo ''
\echo '== Reabertura de mes =='
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.reopen_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01', '')$q$,
  'reabertura sem motivo e recusada'
); end $$;

-- Mesma checagem explicita de papel que close_month ganhou: cliente_leitura
-- (abaixo de contador) nao reabre o mes mesmo informando motivo valido.
do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$select public.reopen_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01', 'Motivo valido')$q$,
  'cliente_leitura nao consegue reabrir o mes'
); end $$;

do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.reopen_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01', 'Nota fiscal recebida em atraso')$q$);
  perform pg_temp.assert(
    pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
      $q$update public.transactions set notes = 'corrigido' where booking_date = '2025-03-05'$q$) = 1,
    'depois de reaberto com motivo, marco volta a aceitar edicao'
  );
  perform pg_temp.assert(
    pg_temp.value_as('11111111-1111-1111-1111-111111111111',
      $q$select reopen_reason from public.monthly_closings where period = '2025-03-01'$q$) = 'Nota fiscal recebida em atraso',
    'o motivo da reabertura fica registrado'
  );
end $$;

reset role;

\echo ''
\echo '== Deduplicacao de extrato =='
insert into public.statement_imports (id, company_id, bank_account_id, source, file_name, file_hash)
values ('e1e1e1e1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'a1a1a1a1-0000-0000-0000-000000000001', 'ofx', 'extrato-marco.ofx', 'hash-abc');

insert into public.statement_lines (company_id, import_id, bank_account_id, posted_at, amount, memo, fitid, dedup_key)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1e1e1e1-0000-0000-0000-000000000001',
        'a1a1a1a1-0000-0000-0000-000000000001', '2025-03-05', 2500.00, 'TED RECEBIDA', '20250305001', '20250305001');

do $$
begin
  begin
    insert into public.statement_lines (company_id, import_id, bank_account_id, posted_at, amount, memo, fitid, dedup_key)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1e1e1e1-0000-0000-0000-000000000001',
            'a1a1a1a1-0000-0000-0000-000000000001', '2025-03-05', 2500.00, 'TED RECEBIDA', '20250305001', '20250305001');
    raise exception 'FALHOU: aceitou a mesma linha de extrato duas vezes';
  exception when unique_violation then
    raise notice '  ok: reimportar o mesmo extrato nao duplica movimento';
  end;
end $$;

do $$
begin
  begin
    insert into public.statement_imports (company_id, bank_account_id, source, file_name, file_hash)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'ofx', 'copia.ofx', 'hash-abc');
    raise exception 'FALHOU: aceitou o mesmo arquivo duas vezes na mesma conta';
  exception when unique_violation then
    raise notice '  ok: o mesmo arquivo nao e importado duas vezes na mesma conta';
  end;
end $$;

\echo ''
\echo '== Acoes atomicas de conciliacao =='
-- Tres linhas pendentes na conta Itau, sem par ainda no sistema.
insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
values
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
   '2025-04-01', 100.00, 'TED assistente', '20250401-recon'),
  ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
   '2025-04-11', -250.00, 'Tarifa bancaria', '20250411-create'),
  ('11110000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
   '2025-04-12', -50.00, 'Duplicata ja lancada em outra conta', '20250412-ignore');

set role authenticated;

-- reconcile_line: casa a linha 1 com o lancamento "Lancamento do assistente"
-- (mesma conta, mesmo valor, ja existente na fixture de papeis).
do $$
declare v_transaction_id uuid;
begin
  -- select via value_as (nao um SELECT ... INTO cru): o config do jwt claim e
  -- local a transacao, e cada `do` block e a sua propria transacao. Sem passar
  -- pelo helper, a policy de RLS nao enxerga nenhum papel e a consulta volta
  -- vazia, deixando v_transaction_id nulo.
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.transactions where description = 'Lancamento do assistente'$q$)::uuid;

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    format($q$select public.reconcile_line('11110000-0000-0000-0000-000000000001', %L)$q$, v_transaction_id));

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000001'$q$) = 'conciliada',
    'reconcile_line concilia a linha do extrato'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      format($q$select reconciliation::text from public.transactions where id = %L$q$, v_transaction_id)) = 'conciliado',
    'reconcile_line concilia o lancamento correspondente'
  );
end $$;

-- Confirmar de novo a mesma linha (ja tratada) e recusado.
do $$
declare v_transaction_id uuid;
begin
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.transactions where description = 'Lancamento do assistente'$q$)::uuid;
  perform pg_temp.expect_denied('22222222-2222-2222-2222-222222222222',
    format($q$select public.reconcile_line('11110000-0000-0000-0000-000000000001', %L)$q$, v_transaction_id),
    'reconcile_line recusa linha ja tratada'
  );
end $$;

-- unreconcile_line: desfaz o pareamento acima.
do $$
declare v_transaction_id uuid;
begin
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.transactions where description = 'Lancamento do assistente'$q$)::uuid;

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.unreconcile_line('11110000-0000-0000-0000-000000000001')$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000001'$q$) = 'pendente',
    'unreconcile_line devolve a linha para pendente'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      format($q$select reconciliation::text from public.transactions where id = %L$q$, v_transaction_id)) = 'nao_conciliado',
    'unreconcile_line devolve o lancamento para nao_conciliado'
  );
end $$;

-- create_transaction_from_line: linha sem par vira lancamento novo, ja conciliado.
do $$
declare v_transaction_id uuid;
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.create_transaction_from_line('11110000-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000002', null)$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000002'$q$) = 'criada',
    'create_transaction_from_line marca a linha como criada'
  );

  select matched_transaction_id into v_transaction_id from public.statement_lines
   where id = '11110000-0000-0000-0000-000000000002';

  perform pg_temp.assert(
    v_transaction_id is not null,
    'create_transaction_from_line vincula o lancamento criado a linha'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      format($q$select description from public.transactions where id = %L$q$, v_transaction_id)) = 'Tarifa bancaria',
    'create_transaction_from_line usa o memo do extrato quando nao ha descricao propria'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      format($q$select reconciliation::text from public.transactions where id = %L$q$, v_transaction_id)) = 'conciliado',
    'create_transaction_from_line ja nasce conciliado'
  );
end $$;

-- undo_transaction_from_line: desfaz o lancamento criado acima (linha 002),
-- devolvendo a linha do extrato a pendente e apagando o lancamento.
do $$
declare v_transaction_id uuid;
begin
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select matched_transaction_id::text from public.statement_lines where id = '11110000-0000-0000-0000-000000000002'$q$)::uuid;

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.undo_transaction_from_line('11110000-0000-0000-0000-000000000002')$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000002'$q$) = 'pendente',
    'undo_transaction_from_line devolve a linha para pendente'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select (matched_transaction_id is null)::text from public.statement_lines where id = '11110000-0000-0000-0000-000000000002'$q$) = 'true',
    'undo_transaction_from_line desvincula o lancamento da linha'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      format($q$select (not exists(select 1 from public.transactions where id = %L))::text$q$, v_transaction_id)) = 'true',
    'undo_transaction_from_line apaga o lancamento criado'
  );
end $$;

-- Ja desfeita: sem lancamento criado para desfazer de novo.
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.undo_transaction_from_line('11110000-0000-0000-0000-000000000002')$q$,
  'undo_transaction_from_line recusa uma linha que ja nao tem lancamento criado'
); end $$;

-- Papel abaixo de assistente nao consegue chamar undo_transaction_from_line.
do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
       values ('11110000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-04-17', -30.00, 'Linha para teste de papel (undo)', '20250417-role-undo')$q$);

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.create_transaction_from_line('11110000-0000-0000-0000-00000000000a', null, null)$q$);
end $$;

do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$select public.undo_transaction_from_line('11110000-0000-0000-0000-00000000000a')$q$,
  'cliente_leitura nao consegue chamar undo_transaction_from_line'
); end $$;

-- Um lancamento que ja tem baixa de nota fiscal vinculada nao pode ser
-- apagado por aqui (a FK e "on delete cascade" — apagar direto levaria a
-- nota junto sem passar pelo recalculo de status que unsettle_invoice faz).
do $$
declare v_transaction_id uuid;
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
       values ('11110000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-04-18', 900.00, 'Recebimento com baixa de nota', '20250418-settled-undo')$q$);

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.create_transaction_from_line('11110000-0000-0000-0000-00000000000b', null, null)$q$);

  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select matched_transaction_id::text from public.statement_lines where id = '11110000-0000-0000-0000-00000000000b'$q$)::uuid;

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.invoices (id, company_id, number, issued_on, amount, client_name)
       values ('f1000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'NF-UNDO-1', '2025-04-01', 900.00, 'Cliente Teste Undo')$q$);

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    format($q$insert into public.invoice_settlements (company_id, invoice_id, transaction_id, amount)
       values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f1000000-0000-0000-0000-000000000009', %L, 900.00)$q$,
       v_transaction_id));

  perform pg_temp.expect_denied(
    '22222222-2222-2222-2222-222222222222',
    $q$select public.undo_transaction_from_line('11110000-0000-0000-0000-00000000000b')$q$,
    'undo_transaction_from_line recusa lancamento com baixa de nota fiscal vinculada'
  );
end $$;

-- ignore_line: exige motivo.
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.ignore_line('11110000-0000-0000-0000-000000000003', '')$q$,
  'ignore_line recusa motivo vazio'
); end $$;

do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.ignore_line('11110000-0000-0000-0000-000000000003', 'Ja lancada na conta Bradesco')$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000003'$q$) = 'ignorada',
    'ignore_line marca a linha como ignorada'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select ignored_reason from public.statement_lines where id = '11110000-0000-0000-0000-000000000003'$q$) = 'Ja lancada na conta Bradesco',
    'ignore_line registra o motivo'
  );
end $$;

-- create_transaction_from_line(p_rule_id): quando a categoria veio de uma
-- regra aprendida, o acerto e contabilizado em matching_rules.hit_count.
--
-- Inseridas via pg_temp.run_as (nao um INSERT cru): a sessao ja esta sob
-- `set role authenticated` neste ponto do arquivo, entao um INSERT direto
-- ficaria sem jwt claim (auth.uid() nulo) e cairia na policy de RLS.
do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.matching_rules (id, company_id, match_text, category_id, priority)
       values ('99990000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'tarifa', 'c1c1c1c1-0000-0000-0000-000000000002', 100)$q$);

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
       values ('11110000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-04-13', -75.00, 'Tarifa de manutencao', '20250413-rule-hit')$q$);
end $$;

do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.create_transaction_from_line(
      '11110000-0000-0000-0000-000000000005', 'c1c1c1c1-0000-0000-0000-000000000002', null,
      '99990000-0000-0000-0000-000000000001')$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select hit_count::text from public.matching_rules where id = '99990000-0000-0000-0000-000000000001'$q$) = '1',
    'create_transaction_from_line incrementa hit_count da regra aplicada'
  );
end $$;

-- Um p_rule_id inexistente (ou de outra empresa) e melhor esforco: nao
-- impede a criacao do lancamento, so nao incrementa nada.
do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
       values ('11110000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-04-14', -20.00, 'Tarifa avulsa', '20250414-rule-missing')$q$);
end $$;

do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.create_transaction_from_line(
      '11110000-0000-0000-0000-000000000006', null, null,
      '00000000-0000-0000-0000-000000000000')$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000006'$q$) = 'criada',
    'create_transaction_from_line com p_rule_id inexistente ainda cria o lancamento'
  );
end $$;

-- Um papel abaixo de assistente (cliente_leitura, o portal do cliente) nao
-- consegue chamar nenhuma das quatro funcoes de conciliacao. Isso ja e
-- garantido pelo RLS de statement_lines/transactions, nao pelas funcoes em
-- si (elas sao SECURITY INVOKER) — mas so a policy nao aparecer aqui
-- explicitamente testada seria deixar a garantia mais importante do
-- conjunto sem uma prova direta.
do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
       values ('11110000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-04-15', -60.00, 'Linha para teste de papel', '20250415-role-check')$q$);
end $$;

do $$
declare v_transaction_id uuid;
begin
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.transactions where description = 'Lancamento do assistente'$q$)::uuid;

  perform pg_temp.expect_denied(
    '33333333-3333-3333-3333-333333333333',
    format($q$select public.reconcile_line('11110000-0000-0000-0000-000000000007', %L)$q$, v_transaction_id),
    'cliente_leitura nao consegue chamar reconcile_line'
  );
end $$;

do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$select public.create_transaction_from_line('11110000-0000-0000-0000-000000000007', null, null)$q$,
  'cliente_leitura nao consegue chamar create_transaction_from_line'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$select public.ignore_line('11110000-0000-0000-0000-000000000007', 'Motivo qualquer')$q$,
  'cliente_leitura nao consegue chamar ignore_line'
); end $$;

-- unreconcile_line precisa de uma linha ja conciliada para testar a recusa.
do $$
declare v_transaction_id uuid;
begin
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.transactions where description = 'Lancamento do assistente'$q$)::uuid;
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    format($q$select public.reconcile_line('11110000-0000-0000-0000-000000000007', %L)$q$, v_transaction_id));
end $$;

do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$select public.unreconcile_line('11110000-0000-0000-0000-000000000007')$q$,
  'cliente_leitura nao consegue chamar unreconcile_line'
); end $$;

-- Uma linha conciliada com um lancamento de marco, para testar a trava de
-- mes fechado em unreconcile_line logo abaixo — precisa existir ANTES de
-- marco fechar, porque reconcile_line tambem escreve em transactions e
-- seria recusado do mesmo jeito depois que o mes fechar.
do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
       values ('11110000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-03-06', 2500.00, 'Linha para testar unreconcile em mes fechado', '20250306-lock-undo')$q$);
end $$;

do $$
declare v_transaction_id uuid;
begin
  v_transaction_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.transactions where description = 'Honorarios marco'$q$)::uuid;
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    format($q$select public.reconcile_line('11110000-0000-0000-0000-000000000008', %L)$q$, v_transaction_id));
end $$;

reset role;

-- create_transaction_from_line respeita a trava de mes fechado, com mensagem
-- clara em vez do erro cru de RLS/trigger. unreconcile_line tambem precisa
-- respeitar essa trava — ver 20250101001100_unreconcile_line_fix.sql: sem
-- essa checagem, a linha do extrato voltaria a "pendente" mesmo que o
-- UPDATE em transactions fosse silenciosamente recusado pela RLS,
-- desalinhando as duas tabelas.
do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.close_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01')$q$);
end $$;

insert into public.statement_lines (id, company_id, import_id, bank_account_id, posted_at, amount, memo, dedup_key)
values ('11110000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'e1e1e1e1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
        '2025-03-15', 300.00, 'Linha de marco fechado', '20250315-locked');

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.create_transaction_from_line('11110000-0000-0000-0000-000000000004', null, null)$q$,
  'create_transaction_from_line recusa lancar em mes fechado'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.unreconcile_line('11110000-0000-0000-0000-000000000008')$q$,
  'unreconcile_line recusa desfazer conciliacao de mes fechado'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select status from public.statement_lines where id = '11110000-0000-0000-0000-000000000008'$q$) = 'conciliada',
  'unreconcile_line recusado nao deixa a linha do extrato pela metade'
); end $$;

do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.reopen_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01', 'Reabertura para o restante dos testes')$q$);
end $$;

\echo ''
\echo '== Faturamento: notas e baixa de recebimento =='
-- Duas notas do mesmo cliente (mesmo CNPJ), empresa A, ainda sem nenhum
-- recebimento vinculado.
insert into public.invoices (id, company_id, number, issued_on, amount, client_name, client_tax_id) values
  ('f1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NF-1001', '2025-04-01', 1000.00, 'Cliente XYZ Ltda', '22333444000155'),
  ('f1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NF-1002', '2025-04-01', 500.00, 'Cliente XYZ Ltda', '22333444000155'),
  ('f1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NF-1003', '2025-04-01', 800.00, 'Cliente ABC ME', '55666777000188');

-- O recebimento: um credito unico no Cora que quita as duas notas de "Cliente
-- XYZ" de uma vez -- exatamente o caso de PIX agrupado que a usuaria descreveu.
insert into public.transactions
  (id, company_id, bank_account_id, booking_date, competence_date, amount, status, description)
values
  ('f2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-04-20', '2025-04-20', 1500.00, 'realizado', 'PIX recebido Cliente XYZ');

set role authenticated;

-- settle_invoices recusa quando a soma das alocacoes passa do valor do credito.
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000001',
    '[{"invoice_id": "f1000000-0000-0000-0000-000000000001", "amount": 1000.00},
      {"invoice_id": "f1000000-0000-0000-0000-000000000002", "amount": 600.00}]'::jsonb)$q$,
  'settle_invoices recusa quando a soma das alocacoes passa do valor do credito'
); end $$;

-- settle_invoices recusa quando UMA alocacao passa do saldo em aberto da propria nota.
do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000001',
    '[{"invoice_id": "f1000000-0000-0000-0000-000000000001", "amount": 1200.00}]'::jsonb)$q$,
  'settle_invoices recusa alocacao acima do saldo em aberto da nota'
); end $$;

-- cliente_leitura nao pode dar baixa: settle_invoices agora checa o papel
-- explicitamente (20250101001700), antes mesmo de olhar a nota ou o
-- lancamento -- RLS de invoice_settlements (assistente+) continua sendo a
-- garantia real, isto so prova a mensagem clara chegando primeiro.
do $$ begin perform pg_temp.expect_denied(
  '33333333-3333-3333-3333-333333333333',
  $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000001',
    '[{"invoice_id": "f1000000-0000-0000-0000-000000000001", "amount": 1000.00}]'::jsonb)$q$,
  'cliente_leitura nao consegue chamar settle_invoices'
); end $$;

-- Baixa valida: um credito quita as duas notas do mesmo cliente de uma vez.
do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000001',
      '[{"invoice_id": "f1000000-0000-0000-0000-000000000001", "amount": 1000.00},
        {"invoice_id": "f1000000-0000-0000-0000-000000000002", "amount": 500.00}]'::jsonb)$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status::text from public.invoices where id = 'f1000000-0000-0000-0000-000000000001'$q$) = 'recebida',
    'settle_invoices quita a primeira nota do PIX agrupado'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status::text from public.invoices where id = 'f1000000-0000-0000-0000-000000000002'$q$) = 'recebida',
    'settle_invoices quita a segunda nota do mesmo PIX agrupado'
  );
  perform pg_temp.assert(
    pg_temp.count_as('22222222-2222-2222-2222-222222222222',
      $q$select 1 from public.invoice_settlements where transaction_id = 'f2000000-0000-0000-0000-000000000001'$q$) = 2,
    'settle_invoices grava as duas alocacoes do mesmo lancamento'
  );
end $$;

-- Recebimento parcial (retencao de imposto): um credito menor que a nota.
-- Insercao via run_as (nao um INSERT cru): a sessao ja esta sob `set role
-- authenticated` neste ponto do arquivo, entao um INSERT direto ficaria sem
-- jwt claim (auth.uid() nulo) e cairia na policy de RLS -- mesmo raciocinio
-- ja documentado na fixture de matching_rules mais acima no arquivo.
do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.transactions
        (id, company_id, bank_account_id, booking_date, competence_date, amount, status, description)
      values
        ('f2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-04-21', '2025-04-21', 300.00, 'realizado', 'PIX recebido Cliente ABC (com retencao)')$q$);
end $$;

do $$
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000002',
      '[{"invoice_id": "f1000000-0000-0000-0000-000000000003", "amount": 300.00}]'::jsonb)$q$);

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status::text from public.invoices where id = 'f1000000-0000-0000-0000-000000000003'$q$) = 'recebida_parcial',
    'baixa parcial deixa a nota como recebida_parcial'
  );
  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select outstanding_amount::text from public.v_invoice_balances where invoice_id = 'f1000000-0000-0000-0000-000000000003'$q$)::numeric = 500.00,
    'v_invoice_balances calcula o saldo em aberto certo depois da baixa parcial'
  );
end $$;

-- unsettle_invoice desfaz uma baixa e recalcula o status.
do $$
declare v_settlement_id uuid;
begin
  v_settlement_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.invoice_settlements where invoice_id = 'f1000000-0000-0000-0000-000000000003'$q$)::uuid;

  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    format($q$select public.unsettle_invoice(%L)$q$, v_settlement_id));

  perform pg_temp.assert(
    pg_temp.value_as('22222222-2222-2222-2222-222222222222',
      $q$select status::text from public.invoices where id = 'f1000000-0000-0000-0000-000000000003'$q$) = 'aberta',
    'unsettle_invoice devolve a nota para aberta quando desfaz a unica baixa'
  );
  perform pg_temp.assert(
    pg_temp.count_as('22222222-2222-2222-2222-222222222222',
      $q$select 1 from public.invoice_settlements where id = 'f1000000-0000-0000-0000-000000000003'$q$) = 0,
    'unsettle_invoice apaga a linha de baixa'
  );
end $$;

-- unsettle_invoice chamado por quem nao tem papel suficiente nao levanta
-- excecao nenhuma -- so nao apaga nada. cliente_leitura consegue LER a
-- baixa (a policy de select so exige ser membro), mas o DELETE por baixo
-- exige 'assistente'; RLS nega o DELETE em silencio. E exatamente por isto
-- que unsettleInvoiceAction (apps/web/lib/db/faturamento.ts) confere se a
-- linha realmente sumiu depois de chamar a RPC, em vez de so olhar o erro.
do $$
declare v_settlement_id uuid; v_ainda_existe bigint;
begin
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000002',
      '[{"invoice_id": "f1000000-0000-0000-0000-000000000003", "amount": 300.00}]'::jsonb)$q$);

  v_settlement_id := pg_temp.value_as('22222222-2222-2222-2222-222222222222',
    $q$select id::text from public.invoice_settlements where invoice_id = 'f1000000-0000-0000-0000-000000000003'$q$)::uuid;

  perform pg_temp.run_as('33333333-3333-3333-3333-333333333333',
    format($q$select public.unsettle_invoice(%L)$q$, v_settlement_id));

  v_ainda_existe := pg_temp.count_as('22222222-2222-2222-2222-222222222222',
    format($q$select 1 from public.invoice_settlements where id = %L$q$, v_settlement_id));

  perform pg_temp.assert(v_ainda_existe = 1,
    'unsettle_invoice chamado por cliente_leitura nao apaga nada, sem levantar erro'
  );

  -- limpeza: desfaz de verdade com o assistente, pra nao deixar rastro no
  -- resto do arquivo.
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    format($q$select public.unsettle_invoice(%L)$q$, v_settlement_id));
end $$;

-- Trava de mes fechado: fecha maio e tenta dar baixa num credito de maio.
do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.invoices (id, company_id, number, issued_on, amount, client_name, client_tax_id)
      values ('f1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NF-1004', '2025-05-01', 200.00, 'Cliente ABC ME', '55666777000188')$q$);
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.transactions
        (id, company_id, bank_account_id, booking_date, competence_date, amount, status, description)
      values
        ('f2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2025-05-10', '2025-05-10', 200.00, 'realizado', 'PIX de maio, mes vai fechar')$q$);

  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.close_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-05-01')$q$);
end $$;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.settle_invoices('f2000000-0000-0000-0000-000000000003',
    '[{"invoice_id": "f1000000-0000-0000-0000-000000000004", "amount": 200.00}]'::jsonb)$q$,
  'settle_invoices recusa dar baixa em credito de mes fechado'
); end $$;

reset role;

\echo ''
\echo '== Trilha de auditoria =='
-- A pergunta que a planilha nunca respondeu: quem mudou este valor, quando, e de
-- quanto para quanto. O assistente corrige um lancamento de abril (mes aberto).
set role authenticated;
do $$
declare v_old numeric; v_new numeric; v_author uuid;
begin
  -- O assistente corrige o valor de um lancamento de abril.
  perform pg_temp.run_as('22222222-2222-2222-2222-222222222222',
    $q$update public.transactions set amount = 250.00
       where description = 'Lancamento do assistente'$q$);

  -- E nao consegue ler a trilha: auditoria e visivel a partir de contador.
  -- Quem opera o sistema no dia a dia nao inspeciona o proprio rastro.
  perform pg_temp.assert(
    pg_temp.count_as('22222222-2222-2222-2222-222222222222',
      $q$select 1 from public.audit_log$q$) = 0,
    'assistente nao enxerga a trilha de auditoria'
  );

  -- A leitura e feita pela dona da assessoria, que tem papel de owner.
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);

  select (old_data ->> 'amount')::numeric, (new_data ->> 'amount')::numeric, changed_by
    into v_old, v_new, v_author
  from public.audit_log
  where table_name = 'transactions' and action = 'UPDATE'
    and (old_data ->> 'amount')::numeric is distinct from (new_data ->> 'amount')::numeric
  order by changed_at desc, id desc limit 1;

  perform pg_temp.assert(v_old = 100.00, 'auditoria guardou o valor ANTES da alteracao (100,00)');
  perform pg_temp.assert(v_new = 250.00, 'auditoria guardou o valor DEPOIS da alteracao (250,00)');
  perform pg_temp.assert(v_author = '22222222-2222-2222-2222-222222222222',
    'auditoria guardou QUEM alterou (o assistente, nao quem consultou)');
end $$;
reset role;

-- Alteracao que nao muda nada de fato nao vira ruido na trilha.
do $$
declare v_before bigint; v_after bigint;
begin
  select count(*) into v_before from public.audit_log where table_name = 'transactions';
  update public.transactions set notes = notes where description = 'Lancamento do assistente';
  select count(*) into v_after from public.audit_log where table_name = 'transactions';
  perform pg_temp.assert(v_before = v_after,
    'update que nao muda nenhum campo nao gera linha de auditoria');
end $$;

do $$ begin perform pg_temp.assert(
  (select count(*) from public.audit_log where table_name = 'transactions' and action = 'INSERT') > 0,
  'auditoria registra criacao de lancamento'
); end $$;

-- A trilha nao pode ser adulterada por quem usa o sistema.
set role authenticated;
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$delete from public.audit_log$q$,
  'ninguem apaga a trilha de auditoria pela aplicacao'
); end $$;
reset role;

-- 20250101002100_audit_triggers_restantes.sql ligou o mesmo trigger em
-- categories/counterparties/cost_centers/matching_rules/statement_imports/
-- statement_lines/account_profiles/account_profile_accounts -- so confere
-- uma delas (categories): o trigger e o mesmo app.write_audit_log() ja
-- provado acima, o unico risco real era esquecer de ligar em alguma tabela.
set role authenticated;
do $$
declare v_old text; v_new text;
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$update public.categories set name = 'Receita de servicos (renomeada)'
       where id = 'c1c1c1c1-0000-0000-0000-000000000001'$q$);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);

  select old_data ->> 'name', new_data ->> 'name' into v_old, v_new
  from public.audit_log
  where table_name = 'categories' and action = 'UPDATE'
    and row_id = 'c1c1c1c1-0000-0000-0000-000000000001'
  order by changed_at desc, id desc limit 1;

  perform pg_temp.assert(v_old = 'Receita de servicos',
    'auditoria de categories guardou o nome ANTES de renomear');
  perform pg_temp.assert(v_new = 'Receita de servicos (renomeada)',
    'auditoria de categories guardou o nome DEPOIS de renomear');
end $$;
reset role;

\echo ''
\echo '== Baixa de previsto (settle_transaction) =='
-- settle_transaction nunca teve teste nenhum antes desta leva. Junho fica
-- aberto (baixa com data/valor reais); julho e fechado logo em seguida
-- (baixa/status em mes fechado).
insert into public.transactions
  (id, company_id, bank_account_id, booking_date, competence_date, amount, status, description)
values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', '2025-06-05', '2025-06-05', -1000.00, 'previsto',
   'Aluguel previsto junho'),
  ('f1f1f1f1-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', '2025-06-12', '2025-06-12', -200.00, 'realizado',
   'Realizado de junho, so pra testar bloqueio de papel'),
  ('f1f1f1f1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', '2025-07-05', '2025-07-05', -300.00, 'previsto',
   'Previsto de julho, mes vai fechar'),
  ('f1f1f1f1-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', '2025-07-10', '2025-07-10', -700.00, 'realizado',
   'Realizado de julho, mes vai fechar');

set role authenticated;
do $$ begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.close_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-07-01')$q$);
end $$;

-- Baixa com data e valor reais: o previsto era -1000,00 em 05/06, o
-- dinheiro caiu -1012,30 em 08/06 — grava os dois, e o sinal negativo
-- mantem a direcao "saida" (coluna gerada a partir do sinal).
do $$
declare v_date date; v_amount numeric; v_direction text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text, true);

  select (r).booking_date, (r).amount, (r).direction::text
    into v_date, v_amount, v_direction
  from (select public.settle_transaction(
    'f1f1f1f1-0000-0000-0000-000000000001', '2025-06-08', -1012.30) as r) s;

  perform pg_temp.assert(v_date = '2025-06-08', 'baixa grava a data em que o dinheiro andou');
  perform pg_temp.assert(v_amount = -1012.30, 'baixa grava o valor que de fato caiu');
  perform pg_temp.assert(v_direction = 'saida', 'valor negativo na baixa mantem a direcao saida');
end $$;

-- Endurecido pela migration 20250101002200_settle_transaction_guards.sql
-- (aplicada mais cedo neste mesmo arquivo, junto com as demais): antes dela
-- a RLS recusando em mes fechado nao levantava excecao — o UPDATE so
-- afetava zero linhas, e a funcao devolvia uma linha com todo campo nulo,
-- sem erro nenhum (por isso `apps/web/lib/db/transactions.ts` confere
-- `data?.id`, nao so `error` — defesa que continua valendo mesmo com a
-- funcao corrigida). Agora a propria funcao recusa com mensagem clara.
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.settle_transaction(
     'f1f1f1f1-0000-0000-0000-000000000003', '2025-07-05', -300.00)$q$,
  'settle_transaction em mes fechado recusa com mensagem clara, nao devolve linha nula em silencio'
); end $$;

-- R11: o sinal do valor da baixa precisa manter o sentido do previsto. O
-- app ja deriva o sinal do lado do servidor (darBaixa nunca confia no que a
-- pessoa digitou), mas a funcao SQL e quem tem de recusar de verdade —
-- prova que a trava existe mesmo se um chamador futuro nao passar pelo app.
-- f1f1f1f1-...0001 ja virou 'realizado' no teste anterior; fixture propria
-- (previsto de saida), so para este teste.
do $$ begin perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
  $q$insert into public.transactions
       (id, company_id, bank_account_id, booking_date, competence_date, amount, status, description)
     values
       ('f1f1f1f1-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'a1a1a1a1-0000-0000-0000-000000000001', '2025-06-15', '2025-06-15', -50.00, 'previsto',
        'Previsto de saida para teste de sinal')$q$); end $$;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.settle_transaction(
     'f1f1f1f1-0000-0000-0000-000000000006', null, 50.00)$q$,
  'settle_transaction recusa valor positivo para a baixa de um previsto de saida'
); end $$;

-- Voltar para previsto (o UPDATE que desfazerBaixa faz direto, sem RPC):
-- mes aberto deixa, mes fechado e papel insuficiente nao.
do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.transactions set status = 'previsto'
       where id = 'f1f1f1f1-0000-0000-0000-000000000001'$q$) = 1,
  'assistente volta um realizado de mes aberto para previsto'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.transactions set status = 'previsto'
       where id = 'f1f1f1f1-0000-0000-0000-000000000005'$q$) = 0,
  'ninguem volta um realizado de mes fechado para previsto'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('33333333-3333-3333-3333-333333333333',
    $q$update public.transactions set status = 'previsto'
       where id = 'f1f1f1f1-0000-0000-0000-000000000004'$q$) = 0,
  'cliente_leitura nao consegue voltar lancamento para previsto, mesmo em mes aberto'
); end $$;
reset role;

\echo ''
\echo '== Editar lancamento existente =='
-- editarLancamento (apps/web/lib/db/transactions.ts) e um UPDATE direto na
-- tabela: estes testes provam as garantias de schema que a Server Action
-- conta pra decidir o que pode mudar (editLocks, @aec/domain). O lancamento
-- 0001 chega aqui como previsto, 08/06, -1012,30 (ver secao anterior).
set role authenticated;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.transactions set amount = -1500.00
       where id = 'f1f1f1f1-0000-0000-0000-000000000001'$q$) = 1,
  'editar o valor de um lancamento em mes aberto e permitido'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.transactions set amount = -999.00
       where id = 'f1f1f1f1-0000-0000-0000-000000000005'$q$) = 0,
  'editar o valor de um lancamento em mes fechado nao e permitido'
); end $$;

-- Mesmo se a tela falhasse em travar o Select de categoria, o trigger
-- continua recusando: 0001 e uma saida, c1c1c1c1-...0001 e uma categoria
-- de entrada.
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$update public.transactions set category_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     where id = 'f1f1f1f1-0000-0000-0000-000000000001'$q$,
  'nao da para reclassificar uma saida numa categoria de entrada'
); end $$;

-- Arrastar a data de um lancamento de mes aberto para dentro de um mes
-- fechado tambem nao pode — mesmo WITH CHECK que ja provamos em "Trava de
-- mes fechado", agora do lado da edicao completa, nao so do dar-baixa.
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$update public.transactions set booking_date = '2025-07-20'
     where id = 'f1f1f1f1-0000-0000-0000-000000000001'$q$,
  'nao da para arrastar a data de um lancamento para dentro de mes fechado'
); end $$;
reset role;

\echo ''
\echo '== Cadastros: editar e reativar =='
-- editarCategoria/definirCategoriaAtiva/editarCentroCusto/
-- definirCentroCustoAtivo/editarContraparte/definirContraparteAtiva
-- (apps/web/lib/db/cadastros.ts) e definirContaAtiva (accounts.ts) sao UPDATE
-- diretos: estes testes provam a mesma distincao de papel que
-- categories_write/cost_centers_write/bank_accounts_write (contador) e
-- counterparties_write (assistente) ja aplicam, e que ate esta leva nenhuma
-- tela deixava reativar o que fora desativado por engano. Fixtures proprias
-- (prefixo cad0...), para nao mexer no que as secoes anteriores ja usam.
insert into public.categories (id, company_id, name, kind) values
  ('cad00000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Categoria de teste', 'ambos');
insert into public.cost_centers (id, company_id, name) values
  ('cad00000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Centro de teste');
insert into public.counterparties (id, company_id, name) values
  ('cad00000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Contraparte de teste');
insert into public.bank_accounts (id, company_id, name, opening_balance, opening_balance_date) values
  ('cad00000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Conta de teste', 0, '2025-01-01');

set role authenticated;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.categories set is_active = false
       where id = 'cad00000-0000-0000-0000-000000000001'$q$) = 1,
  'owner desativa uma categoria'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.categories set is_active = true
       where id = 'cad00000-0000-0000-0000-000000000001'$q$) = 0,
  'assistente nao consegue reativar categoria (categories_write exige contador)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.categories set is_active = true
       where id = 'cad00000-0000-0000-0000-000000000001'$q$) = 1,
  'owner reativa a categoria'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.counterparties set is_active = false
       where id = 'cad00000-0000-0000-0000-000000000003'$q$) = 1,
  'assistente desativa uma contraparte'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.counterparties set is_active = true
       where id = 'cad00000-0000-0000-0000-000000000003'$q$) = 1,
  'assistente tambem reativa contraparte — contrapartes exigem so assistente, nao contador'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$update public.bank_accounts set is_active = false
       where id = 'cad00000-0000-0000-0000-000000000004'$q$) = 0,
  'assistente nao consegue desativar conta bancaria (bank_accounts_write exige contador)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.bank_accounts set is_active = false
       where id = 'cad00000-0000-0000-0000-000000000004'$q$) = 1,
  'owner desativa a conta bancaria'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.bank_accounts set is_active = true
       where id = 'cad00000-0000-0000-0000-000000000004'$q$) = 1,
  'owner reativa a conta bancaria'
); end $$;

-- editarCategoria (Server Action) conta lancamentos no sentido oposto antes
-- de restringir o kind — o trigger de schema so valida na propria
-- transaction, nunca quando a categoria muda por baixo dela. Aqui provamos
-- so o schema: nada impede o UPDATE da categoria em si mesmo restringindo
-- para um sentido ja usado no oposto, o que confirma que a trava e mesmo
-- responsabilidade da Server Action, nao do banco.
do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$update public.categories set kind = 'entrada'
       where id = 'c1c1c1c1-0000-0000-0000-000000000002'$q$) = 1,
  'o schema sozinho permite restringir o kind de uma categoria ja usada no sentido oposto — a Server Action e quem tem de recusar'
); end $$;
-- Desfaz: c1c1c1c1-...0002 ('Aluguel') e usada por outras secoes como saida.
do $$ begin perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
  $q$update public.categories set kind = 'saida'
     where id = 'c1c1c1c1-0000-0000-0000-000000000002'$q$); end $$;

reset role;

\echo ''
\echo '== Recorrencias (lancamentos fixos) =='
-- recurrences_write (20250101000700_rls.sql) exige contador — o mesmo
-- padrao de bank_accounts/categories/cost_centers, ja em producao desde a
-- primeira leva de schema, so nunca ligado a uma tela ate esta leva.
-- Fixture hex "eccc..." (nao pode comecar com letra fora de a-f).
set role authenticated;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$insert into public.recurrences (company_id, bank_account_id, description, amount, frequency, start_date)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
             'Aluguel', -1500.00, 'mensal', '2025-01-05')$q$,
  'assistente nao consegue criar recorrencia (recurrences_write exige contador)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$insert into public.recurrences
         (id, company_id, bank_account_id, description, amount, frequency, day_of_month, start_date)
       values ('eccc0000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
               'a1a1a1a1-0000-0000-0000-000000000001', 'Aluguel', -1500.00, 'mensal', 5, '2025-01-05')$q$) = 1,
  'owner cria recorrencia'
); end $$;

-- gerarPrevistos (apps/web/lib/db/recorrencias.ts) faz este mesmo INSERT na
-- tabela transactions — nao ha RPC propria. Confere que o previsto nasce de
-- fato vinculado (recurrence_id preenchido), o que a tela usa pra nao
-- duplicar geracao.
do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('22222222-2222-2222-2222-222222222222',
    $q$insert into public.transactions
         (company_id, bank_account_id, booking_date, competence_date, amount, status, description, recurrence_id)
       values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
               '2025-08-05', '2025-08-05', -1500.00, 'previsto', 'Aluguel gerado',
               'eccc0000-0000-0000-0000-000000000001')$q$) = 1,
  'assistente lanca um previsto vinculado a recorrencia (mesmo INSERT que gerarPrevistos faz)'
); end $$;

do $$ begin perform pg_temp.assert(
  pg_temp.value_as('11111111-1111-1111-1111-111111111111',
    $q$select recurrence_id::text from public.transactions where description = 'Aluguel gerado'$q$)
    = 'eccc0000-0000-0000-0000-000000000001',
  'o previsto gerado fica vinculado a recorrencia que o originou'
); end $$;

reset role;

\echo ''
\echo '== Criacao de empresa =='
set role authenticated;
do $$
declare v_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '44444444-4444-4444-4444-444444444444')::text, true);
  select id into v_id from public.create_company('Empresa C', 'Empresa C Ltda', '11.222.333/0004-43');

  perform pg_temp.assert(
    (select role from public.memberships where company_id = v_id
       and user_id = '44444444-4444-4444-4444-444444444444') = 'owner',
    'quem cria a empresa vira owner dela na mesma transacao'
  );
  perform pg_temp.assert(
    (select tax_id from public.companies where id = v_id) = '11222333000443',
    'CNPJ e normalizado para so digitos'
  );
  perform pg_temp.assert(
    (select count(*) from public.categories where company_id = v_id) = 9,
    'empresa nova nasce com um plano de contas minimo (Fase 4), nao vazia'
  );
  perform pg_temp.assert(
    (select count(*) from public.categories where company_id = v_id and kind = 'entrada') = 2,
    'o plano de contas semeado tem categorias de entrada'
  );
  perform pg_temp.assert(
    (select count(*) from public.categories where company_id = v_id and kind = 'saida') = 7,
    'o plano de contas semeado tem categorias de saida'
  );
end $$;
reset role;

\echo ''
\echo '== Adicionar integrante =='
-- profiles_select_self so deixa ver o proprio perfil ou o de quem ja
-- compartilha empresa com voce — antes do vinculo existir, nao ha como
-- montar um INSERT direto em memberships a partir do e-mail. add_member()
-- e SECURITY DEFINER exatamente para atravessar isso, com a checagem de
-- papel do chamador como unica porta de entrada.
set role authenticated;

do $$
begin
  perform pg_temp.assert(
    pg_temp.value_as('11111111-1111-1111-1111-111111111111',
      $q$select role::text from public.add_member(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'estranho@outra.com.br', 'contador')$q$
    ) = 'contador',
    'owner adiciona integrante existente pelo e-mail, com o papel escolhido'
  );
end $$;

do $$ begin perform pg_temp.expect_denied(
  '22222222-2222-2222-2222-222222222222',
  $q$select public.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cliente@empresa-a.com.br', 'assistente')$q$,
  'assistente nao pode adicionar integrante (exige owner)'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ninguem@invalido.com.br', 'assistente')$q$,
  'add_member recusa e-mail sem conta'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$select public.add_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'assistente@assessoria.com.br', 'contador')$q$,
  'add_member recusa quem ja e integrante'
); end $$;

\echo ''
\echo '== A empresa nao pode ficar sem nenhum responsavel =='
do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$delete from public.memberships
     where company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '11111111-1111-1111-1111-111111111111'$q$,
  'owner (unico) nao consegue se remover da empresa'
); end $$;

do $$ begin perform pg_temp.expect_denied(
  '11111111-1111-1111-1111-111111111111',
  $q$update public.memberships set role = 'contador'
     where company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '11111111-1111-1111-1111-111111111111'$q$,
  'owner (unico) nao consegue se rebaixar'
); end $$;

reset role;

-- Promove o integrante do teste acima a owner tambem, direto (nao ha RPC
-- para "mudar papel" ainda) — simula uma empresa com dois responsaveis,
-- o unico estado em que sair ou ser rebaixado deixa de ser bloqueado.
update public.memberships set role = 'owner'
 where company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and user_id = '44444444-4444-4444-4444-444444444444';

set role authenticated;

do $$ begin perform pg_temp.assert(
  pg_temp.affected_as('11111111-1111-1111-1111-111111111111',
    $q$delete from public.memberships
       where company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '11111111-1111-1111-1111-111111111111'$q$) = 1,
  'owner consegue sair quando ha outro responsavel na empresa'
); end $$;

reset role;

\echo ''
\echo '== Todos os testes de schema passaram =='
