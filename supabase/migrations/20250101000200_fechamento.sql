-- =============================================================================
-- Fechamento mensal.
--
-- E o que o Excel nao tem: depois de fechado, o mes nao aceita mais escrita, e a
-- reabertura fica registrada com autor e motivo. A trava e aplicada por RLS
-- policy, no banco, e nao por um `if` no front — onde nao ha como contornar.
-- =============================================================================

create table public.monthly_closings (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  period         date not null,                          -- sempre dia 1 do mes
  locked_at      timestamptz,
  locked_by      uuid references public.profiles (id),
  reopened_at    timestamptz,
  reopened_by    uuid references public.profiles (id),
  reopen_reason  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, period),
  constraint monthly_closings_period_is_first_day
    check (period = date_trunc('month', period)::date),
  constraint monthly_closings_reopen_requires_reason
    check (reopened_at is null or length(btrim(coalesce(reopen_reason, ''))) > 0)
);

-- Snapshot do saldo de cada conta no fechamento. Congela o historico: mesmo que
-- alguem reabra o mes, da para provar qual saldo foi reportado ao cliente.
create table public.monthly_closing_balances (
  closing_id       uuid not null references public.monthly_closings (id) on delete cascade,
  bank_account_id  uuid not null references public.bank_accounts (id) on delete restrict,
  closing_balance  numeric(14,2) not null,
  primary key (closing_id, bank_account_id)
);

create trigger monthly_closings_touch before update on public.monthly_closings
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- A funcao consultada por toda policy de escrita em dados de movimento.
-- -----------------------------------------------------------------------------
create or replace function app.is_period_locked(p_company_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.monthly_closings c
    where c.company_id = p_company_id
      and c.period = date_trunc('month', p_date)::date
      and c.locked_at is not null
  );
$$;

grant execute on function app.is_period_locked(uuid, date) to authenticated;
