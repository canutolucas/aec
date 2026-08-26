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

reset role;

-- create_transaction_from_line respeita a trava de mes fechado, com mensagem
-- clara em vez do erro cru de RLS/trigger.
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

do $$
begin
  perform pg_temp.run_as('11111111-1111-1111-1111-111111111111',
    $q$select public.reopen_month('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-03-01', 'Reabertura para o restante dos testes')$q$);
end $$;

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
end $$;
reset role;

\echo ''
\echo '== Todos os testes de schema passaram =='
