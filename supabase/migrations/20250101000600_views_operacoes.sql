-- =============================================================================
-- Views de saldo e operacoes que precisam ser atomicas.
--
-- Nenhuma view guarda saldo: todas derivam de opening_balance + movimento. Todas
-- sao security_invoker, ou seriam um furo por onde os dados de um cliente
-- vazariam para outro, contornando o RLS das tabelas.
-- =============================================================================

-- Data de hoje no fuso brasileiro. `current_date` puro devolveria a data em UTC,
-- que depois das 21h ja e o dia seguinte.
create or replace function app.today()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

grant execute on function app.today() to authenticated;

-- -----------------------------------------------------------------------------
-- Lancamento anterior a data do saldo inicial seria contado duas vezes, porque o
-- saldo inicial ja o inclui. Barrado na entrada, com mensagem que explica.
-- -----------------------------------------------------------------------------
create or replace function app.check_transaction_not_before_opening()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_opening date;
begin
  select opening_balance_date into v_opening
  from public.bank_accounts where id = new.bank_account_id;

  if new.booking_date < v_opening then
    raise exception
      'Lancamento em % e anterior ao saldo inicial da conta (%). Ajuste o saldo inicial da conta ou a data do lancamento.',
      new.booking_date, v_opening
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger transactions_check_opening_date
  before insert or update of booking_date, bank_account_id on public.transactions
  for each row execute function app.check_transaction_not_before_opening();

-- -----------------------------------------------------------------------------
-- Saldo por conta.
-- -----------------------------------------------------------------------------
create view public.v_account_balances
with (security_invoker = on) as
select
  a.id                     as bank_account_id,
  a.company_id,
  a.name,
  a.kind,
  a.bank_name,
  a.is_active,
  a.opening_balance,
  a.opening_balance_date,
  a.minimum_balance,
  a.opening_balance + coalesce(sum(t.amount) filter (
    where t.status = 'realizado' and t.booking_date <= app.today()
  ), 0)                    as current_balance,
  a.opening_balance + coalesce(sum(t.amount) filter (
    where t.status = 'realizado'
  ), 0)                    as realized_balance,
  a.opening_balance + coalesce(sum(t.amount), 0) as projected_balance,
  coalesce(sum(t.amount) filter (
    where t.status = 'previsto' and t.booking_date < app.today()
  ), 0)                    as overdue_amount,
  count(t.id) filter (
    where t.status = 'realizado' and t.reconciliation = 'nao_conciliado'
  )                        as unreconciled_count
from public.bank_accounts a
left join public.transactions t
  on t.bank_account_id = a.id
group by a.id;

-- -----------------------------------------------------------------------------
-- Movimento liquido por dia e por conta.
--
-- Serve de insumo para o saldo acumulado e para a projecao, que sao calculados
-- em lib/domain — funcoes puras e testadas. A conta de dinheiro vive em um lugar
-- so; repetir a mesma soma em SQL e em TypeScript e garantir que as duas versoes
-- divirjam com o tempo.
-- -----------------------------------------------------------------------------
create view public.v_account_daily_movement
with (security_invoker = on) as
select
  t.company_id,
  t.bank_account_id,
  t.booking_date,
  t.status,
  sum(t.amount)                                    as net_amount,
  sum(t.amount) filter (where t.amount > 0)        as inflow,
  sum(t.amount) filter (where t.amount < 0)        as outflow,
  count(*)                                         as entry_count
from public.transactions t
group by t.company_id, t.bank_account_id, t.booking_date, t.status;

-- -----------------------------------------------------------------------------
-- Resumo mensal por categoria, base dos relatorios gerenciais.
--
-- Transferencias ficam de fora: mover dinheiro entre contas proprias nao e
-- receita nem despesa. Contar isso e o erro que mais infla numero em planilha.
-- -----------------------------------------------------------------------------
create view public.v_monthly_category_summary
with (security_invoker = on) as
select
  t.company_id,
  date_trunc('month', t.booking_date)::date      as period_cash,
  date_trunc('month', t.competence_date)::date   as period_accrual,
  t.category_id,
  c.name                                          as category_name,
  t.direction,
  t.status,
  sum(t.amount)                                   as total_amount,
  count(*)                                        as entry_count
from public.transactions t
left join public.categories c on c.id = t.category_id
where not t.is_transfer
group by t.company_id, period_cash, period_accrual, t.category_id, c.name, t.direction, t.status;

-- =============================================================================
-- Operacoes atomicas.
--
-- SECURITY INVOKER (o padrao): rodam com as permissoes de quem chamou, entao o
-- RLS continua valendo dentro delas. Uma funcao dessas em SECURITY DEFINER
-- viraria um bypass geral do isolamento entre empresas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Transferencia entre contas: os dois lados nascem juntos ou nao nascem.
-- -----------------------------------------------------------------------------
create or replace function public.create_transfer(
  p_company_id       uuid,
  p_from_account_id  uuid,
  p_to_account_id    uuid,
  p_amount           numeric,
  p_booking_date     date,
  p_description      text,
  p_notes            text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_group uuid := gen_random_uuid();
begin
  if p_amount <= 0 then
    raise exception 'O valor da transferencia deve ser positivo';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'Conta de origem e destino nao podem ser a mesma';
  end if;

  insert into public.transactions
    (company_id, bank_account_id, booking_date, competence_date, amount,
     status, description, notes, transfer_group_id, created_by)
  values
    (p_company_id, p_from_account_id, p_booking_date, p_booking_date, -p_amount,
     'realizado', p_description, p_notes, v_group, auth.uid()),
    (p_company_id, p_to_account_id, p_booking_date, p_booking_date, p_amount,
     'realizado', p_description, p_notes, v_group, auth.uid());

  return v_group;
end;
$$;

-- -----------------------------------------------------------------------------
-- Baixa de um previsto: vira realizado na data em que o dinheiro andou.
-- -----------------------------------------------------------------------------
create or replace function public.settle_transaction(
  p_transaction_id uuid,
  p_booking_date   date default null,
  p_amount         numeric default null
)
returns public.transactions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row public.transactions;
begin
  select * into v_row from public.transactions where id = p_transaction_id;

  if not found then
    raise exception 'Lancamento nao encontrado';
  end if;

  if v_row.status <> 'previsto' then
    raise exception 'Somente lancamentos previstos podem receber baixa';
  end if;

  update public.transactions
     set status        = 'realizado',
         booking_date  = coalesce(p_booking_date, v_row.booking_date),
         amount        = coalesce(p_amount, v_row.amount)
   where id = p_transaction_id
   returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fechamento do mes: grava o snapshot de saldo de cada conta e tranca.
-- -----------------------------------------------------------------------------
create or replace function public.close_month(
  p_company_id uuid,
  p_period     date,
  p_notes      text default null
)
returns public.monthly_closings
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_period  date := date_trunc('month', p_period)::date;
  v_end     date := (v_period + interval '1 month - 1 day')::date;
  v_closing public.monthly_closings;
begin
  insert into public.monthly_closings (company_id, period, locked_at, locked_by, notes)
  values (p_company_id, v_period, now(), auth.uid(), p_notes)
  on conflict (company_id, period) do update
    set locked_at     = now(),
        locked_by     = auth.uid(),
        notes         = coalesce(excluded.notes, public.monthly_closings.notes),
        reopened_at   = null,
        reopened_by   = null,
        reopen_reason = null
  returning * into v_closing;

  delete from public.monthly_closing_balances where closing_id = v_closing.id;

  insert into public.monthly_closing_balances (closing_id, bank_account_id, closing_balance)
  select
    v_closing.id,
    a.id,
    a.opening_balance + coalesce(sum(t.amount) filter (
      where t.status = 'realizado' and t.booking_date <= v_end
    ), 0)
  from public.bank_accounts a
  left join public.transactions t on t.bank_account_id = a.id
  where a.company_id = p_company_id
  group by a.id, a.opening_balance;

  return v_closing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Reabertura: sempre exige motivo, e fica registrada.
-- -----------------------------------------------------------------------------
create or replace function public.reopen_month(
  p_company_id uuid,
  p_period     date,
  p_reason     text
)
returns public.monthly_closings
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_closing public.monthly_closings;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Informe o motivo da reabertura do mes';
  end if;

  update public.monthly_closings
     set locked_at     = null,
         reopened_at   = now(),
         reopened_by   = auth.uid(),
         reopen_reason = p_reason
   where company_id = p_company_id
     and period = date_trunc('month', p_period)::date
   returning * into v_closing;

  if not found then
    raise exception 'Nao existe fechamento para este mes';
  end if;

  return v_closing;
end;
$$;

grant execute on function
  public.create_transfer(uuid, uuid, uuid, numeric, date, text, text),
  public.settle_transaction(uuid, date, numeric),
  public.close_month(uuid, date, text),
  public.reopen_month(uuid, date, text)
to authenticated;
