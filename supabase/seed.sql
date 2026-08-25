-- =============================================================================
-- Dados de exemplo para desenvolvimento.
--
-- Rodam com `supabase db reset`. NAO vao para producao: criam usuarios com senha
-- conhecida.
--
-- O cenario e uma assessoria com duas empresas cliente e quatro pessoas com
-- papeis diferentes, para dar para exercitar o isolamento entre empresas e as
-- permissoes por papel sem precisar cadastrar nada a mao.
-- =============================================================================

-- Usuarios. Senha de todos: senha-de-teste-123
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'responsavel@assessoria.teste', crypt('senha-de-teste-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Responsavel da Assessoria"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'assistente@assessoria.teste', crypt('senha-de-teste-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Assistente"}', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'cliente@empresa-a.teste', crypt('senha-de-teste-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Cliente da Empresa A"}', now(), now())
on conflict (id) do nothing;

insert into public.companies (id, name, legal_name, tax_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Padaria do Bairro', 'Padaria do Bairro Ltda', '11222333000181'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Oficina Central', 'Oficina Central ME', '11222333000262')
on conflict (id) do nothing;

insert into public.memberships (company_id, user_id, role) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'assistente'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'cliente_leitura'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'owner')
on conflict (company_id, user_id) do nothing;

-- Contas. O saldo inicial e datado no primeiro dia do mes retrasado, simulando o
-- dia em que a empresa parou de usar a planilha.
insert into public.bank_accounts
  (id, company_id, name, kind, bank_code, bank_name, branch, account_number, opening_balance, opening_balance_date, minimum_balance)
values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Itau Corrente', 'corrente', '341', 'Banco Itau', '1234', '56789-0', 18500.00,
   (date_trunc('month', app.today()) - interval '2 months')::date, 5000.00),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Bradesco Corrente', 'corrente', '237', 'Banco Bradesco', '0987', '11122-3', 4200.00,
   (date_trunc('month', app.today()) - interval '2 months')::date, null),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Caixa interno', 'caixa', null, null, null, null, 500.00,
   (date_trunc('month', app.today()) - interval '2 months')::date, null),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Banco do Brasil', 'corrente', '001', 'Banco do Brasil', '3344', '77788-9', 9300.00,
   (date_trunc('month', app.today()) - interval '2 months')::date, null)
on conflict (id) do nothing;

-- Plano de contas gerencial enxuto, com o de-para contabil preenchido.
insert into public.categories (id, company_id, name, kind, ledger_account) values
  ('c0000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Vendas', 'entrada', '3.1.01.001'),
  ('c0000001-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Outras receitas', 'entrada', '3.1.09.001'),
  ('c0000001-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fornecedores', 'saida', '4.1.01.001'),
  ('c0000001-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Folha de pagamento', 'saida', '4.1.02.001'),
  ('c0000001-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Aluguel', 'saida', '4.1.03.001'),
  ('c0000001-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Energia, agua e telefone', 'saida', '4.1.03.002'),
  ('c0000001-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tributos', 'saida', '4.1.05.001'),
  ('c0000001-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tarifas bancarias', 'saida', '4.1.06.001'),
  ('c0000002-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Servicos prestados', 'entrada', '3.1.01.001'),
  ('c0000002-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Pecas e materiais', 'saida', '4.1.01.001')
on conflict (id) do nothing;

insert into public.counterparties (id, company_id, name, tax_id) values
  ('dd000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Moinho Sao Jorge', '44555666000177'),
  ('dd000001-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Imobiliaria Central', '77888999000155'),
  ('dd000001-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Energisa Distribuidora', '22333444000188')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Movimento dos ultimos dois meses, gerado com datas relativas a hoje para que os
-- seeds continuem fazendo sentido daqui a um ano.
-- -----------------------------------------------------------------------------
insert into public.transactions
  (company_id, bank_account_id, category_id, counterparty_id, booking_date, competence_date,
   amount, status, description, payment_method, created_by)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'a1a1a1a1-0000-0000-0000-000000000001',
  'c0000001-0000-0000-0000-000000000001',
  null,
  dia,
  dia,
  -- Venda diaria variando entre 800 e 2.400, com fim de semana mais forte.
  round((800 + (extract(day from dia)::int * 37 % 1600) +
         case when extract(dow from dia) in (0, 6) then 600 else 0 end)::numeric, 2),
  'realizado',
  'Vendas do dia',
  'pix',
  '22222222-2222-2222-2222-222222222222'
from generate_series(
  (date_trunc('month', app.today()) - interval '2 months')::date + 1,
  app.today(),
  interval '1 day'
) as dia
where extract(dow from dia) <> 0;

-- Despesas fixas mensais.
insert into public.transactions
  (company_id, bank_account_id, category_id, counterparty_id, booking_date, competence_date,
   amount, status, description, payment_method, created_by)
select
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'a1a1a1a1-0000-0000-0000-000000000001',
  categoria,
  contraparte,
  (mes + (dia_do_mes - 1) * interval '1 day')::date,
  (mes + (dia_do_mes - 1) * interval '1 day')::date,
  valor,
  case when (mes + (dia_do_mes - 1) * interval '1 day')::date <= app.today()
       then 'realizado'::app.transaction_status
       else 'previsto'::app.transaction_status end,
  descricao,
  metodo,
  '22222222-2222-2222-2222-222222222222'
from generate_series(
       (date_trunc('month', app.today()) - interval '2 months')::date,
       (date_trunc('month', app.today()) + interval '1 month')::date,
       interval '1 month'
     ) as mes
cross join (values
  ('c0000001-0000-0000-0000-000000000005'::uuid, 'dd000001-0000-0000-0000-000000000002'::uuid,  5, -3800.00, 'Aluguel do imovel', 'boleto'::app.payment_method),
  ('c0000001-0000-0000-0000-000000000004'::uuid, null::uuid,                                     5, -9200.00, 'Folha de pagamento', 'ted'::app.payment_method),
  ('c0000001-0000-0000-0000-000000000006'::uuid, 'dd000001-0000-0000-0000-000000000003'::uuid, 12,  -740.00, 'Energia eletrica', 'debito_automatico'::app.payment_method),
  ('c0000001-0000-0000-0000-000000000003'::uuid, 'dd000001-0000-0000-0000-000000000001'::uuid, 15, -6400.00, 'Farinha e insumos', 'boleto'::app.payment_method),
  ('c0000001-0000-0000-0000-000000000007'::uuid, null::uuid,                                    20, -2150.00, 'Simples Nacional', 'boleto'::app.payment_method),
  ('c0000001-0000-0000-0000-000000000008'::uuid, null::uuid,                                    28,   -89.90, 'Tarifa de manutencao', 'debito_automatico'::app.payment_method)
) as fixas(categoria, contraparte, dia_do_mes, valor, descricao, metodo)
where (mes + (dia_do_mes - 1) * interval '1 day')::date
        >= (date_trunc('month', app.today()) - interval '2 months')::date;

-- Uma transferencia entre contas, para exercitar o par que se anula.
do $$
declare v_group uuid := gen_random_uuid();
begin
  insert into public.transactions
    (company_id, bank_account_id, booking_date, competence_date, amount, status,
     description, transfer_group_id, created_by)
  values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
     app.today() - 5, app.today() - 5, -5000.00, 'realizado',
     'Transferencia para o Bradesco', v_group, '11111111-1111-1111-1111-111111111111'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000002',
     app.today() - 5, app.today() - 5, 5000.00, 'realizado',
     'Transferencia do Itau', v_group, '11111111-1111-1111-1111-111111111111');
end $$;

-- Um previsto vencido e nao pago, para o painel mostrar o alerta.
insert into public.transactions
  (company_id, bank_account_id, category_id, counterparty_id, booking_date, competence_date,
   amount, status, description, payment_method, created_by)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c0000001-0000-0000-0000-000000000003', 'dd000001-0000-0000-0000-000000000001',
   app.today() - 4, app.today() - 4, -1850.00, 'previsto',
   'Fornecedor em atraso', 'boleto', '22222222-2222-2222-2222-222222222222');

-- Regras de categorizacao ja aprendidas, como ficariam depois de uns meses de uso.
insert into public.matching_rules (company_id, match_text, direction, category_id, counterparty_id, priority)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'imobiliaria central', 'saida',
   'c0000001-0000-0000-0000-000000000005', 'dd000001-0000-0000-0000-000000000002', 10),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'energisa', 'saida',
   'c0000001-0000-0000-0000-000000000006', 'dd000001-0000-0000-0000-000000000003', 10),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'tarifa', 'saida',
   'c0000001-0000-0000-0000-000000000008', null, 50)
on conflict do nothing;

-- Fecha o mes retrasado, deixando o sistema com um mes travado para exercitar a
-- trava e a reabertura.
select public.close_month(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (date_trunc('month', app.today()) - interval '2 months')::date,
  'Fechado automaticamente pelos dados de exemplo'
);
