-- =============================================================================
-- Recorrencias, anexos e auditoria.
-- =============================================================================

create type app.recurrence_frequency as enum ('mensal', 'semanal', 'quinzenal', 'anual');

-- Aluguel, folha, tributos: o que se repete todo mes vira previsto sozinho, em
-- vez de ser redigitado.
create table public.recurrences (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  bank_account_id  uuid not null,
  category_id      uuid,
  counterparty_id  uuid,
  cost_center_id   uuid,
  description      text not null check (length(btrim(description)) > 0),
  amount           numeric(14,2) not null check (amount <> 0),
  frequency        app.recurrence_frequency not null default 'mensal',
  -- Dia do mes do vencimento. Se o mes nao tiver esse dia (31 em fevereiro),
  -- a geracao usa o ultimo dia do mes.
  day_of_month     int check (day_of_month between 1 and 31),
  start_date       date not null,
  end_date         date,
  -- Ate quando os previstos ja foram gerados, para nao duplicar.
  generated_until  date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint recurrences_bank_account_fk
    foreign key (bank_account_id, company_id)
    references public.bank_accounts (id, company_id) on delete cascade,
  constraint recurrences_category_fk
    foreign key (category_id, company_id)
    references public.categories (id, company_id) on delete restrict,
  constraint recurrences_counterparty_fk
    foreign key (counterparty_id, company_id)
    references public.counterparties (id, company_id) on delete restrict,
  constraint recurrences_cost_center_fk
    foreign key (cost_center_id, company_id)
    references public.cost_centers (id, company_id) on delete restrict,
  constraint recurrences_end_after_start
    check (end_date is null or end_date >= start_date)
);

alter table public.transactions
  add constraint transactions_recurrence_fk
  foreign key (recurrence_id) references public.recurrences (id) on delete set null;

create trigger recurrences_touch before update on public.recurrences
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Comprovantes. O arquivo vive no Supabase Storage; aqui fica so o ponteiro.
-- -----------------------------------------------------------------------------
create table public.attachments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  storage_path    text not null unique,
  file_name       text not null,
  content_type    text,
  size_bytes      bigint check (size_bytes >= 0),
  uploaded_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);

create index attachments_transaction_idx on public.attachments (transaction_id);

-- =============================================================================
-- Trilha de auditoria.
--
-- Preenchida por trigger, nunca pela aplicacao: um caminho de escrita esquecido
-- no codigo nao consegue escapar dela. Responde a pergunta que a planilha nunca
-- respondeu — quem mudou este valor, quando, e de quanto para quanto.
-- =============================================================================
create table public.audit_log (
  id          bigint generated always as identity primary key,
  company_id  uuid,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create index audit_log_company_idx on public.audit_log (company_id, changed_at desc);
create index audit_log_row_idx on public.audit_log (table_name, row_id, changed_at desc);

create or replace function app.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  -- UPDATE que nao mudou nada de fato nao vira ruido no log.
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null;
  end if;

  insert into public.audit_log (company_id, table_name, row_id, action, old_data, new_data, changed_by)
  values (
    coalesce((v_new ->> 'company_id')::uuid, (v_old ->> 'company_id')::uuid),
    tg_table_name,
    coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
    tg_op,
    v_old,
    v_new,
    auth.uid()
  );

  return null;
end;
$$;

create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function app.write_audit_log();

create trigger bank_accounts_audit
  after insert or update or delete on public.bank_accounts
  for each row execute function app.write_audit_log();

create trigger monthly_closings_audit
  after insert or update or delete on public.monthly_closings
  for each row execute function app.write_audit_log();

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function app.write_audit_log();
