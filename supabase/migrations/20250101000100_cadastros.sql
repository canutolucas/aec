-- =============================================================================
-- Cadastros: contas bancarias, plano de contas gerencial, contrapartes e
-- centros de custo.
-- =============================================================================

create type app.bank_account_kind as enum (
  'corrente', 'poupanca', 'aplicacao', 'cartao_credito', 'caixa'
);

-- -----------------------------------------------------------------------------
-- Contas bancarias.
--
-- `opening_balance` + `opening_balance_date` sao o ponto de partida: o saldo
-- nunca e um campo mutavel atualizado a cada lancamento. Saldo de hoje =
-- opening_balance + soma dos realizados a partir de opening_balance_date.
-- Saldo armazenado e editavel e a origem numero um de divergencia.
-- -----------------------------------------------------------------------------
create table public.bank_accounts (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  name                  text not null check (length(btrim(name)) > 0),
  kind                  app.bank_account_kind not null default 'corrente',
  bank_code             text,                            -- codigo COMPE, ex '341'
  bank_name             text,
  branch                text,                            -- agencia
  account_number        text,
  opening_balance       numeric(14,2) not null default 0,
  opening_balance_date  date not null,
  minimum_balance       numeric(14,2),                   -- dispara alerta abaixo disso
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index bank_accounts_company_idx on public.bank_accounts (company_id, is_active);

-- -----------------------------------------------------------------------------
-- Plano de contas gerencial, hierarquico.
--
-- `ledger_account` guarda o de-para com o plano de contas do sistema contabil
-- (Dominio, Alterdata, Questor), o que permite exportar lancamentos prontos.
-- -----------------------------------------------------------------------------
create type app.category_kind as enum ('entrada', 'saida', 'ambos');

create table public.categories (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  parent_id       uuid references public.categories (id) on delete restrict,
  name            text not null check (length(btrim(name)) > 0),
  kind            app.category_kind not null,
  ledger_account  text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, parent_id, name)
);

create index categories_company_idx on public.categories (company_id, is_active);

-- Uma categoria nao pode ser filha de categoria de outra empresa nem de si mesma.
create or replace function app.check_category_parent()
returns trigger
language plpgsql
as $$
declare
  v_parent_company uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Categoria nao pode ser pai de si mesma';
  end if;

  select company_id into v_parent_company
  from public.categories where id = new.parent_id;

  if v_parent_company is distinct from new.company_id then
    raise exception 'Categoria pai pertence a outra empresa';
  end if;

  return new;
end;
$$;

create trigger categories_check_parent
  before insert or update on public.categories
  for each row execute function app.check_category_parent();

-- -----------------------------------------------------------------------------
-- Contrapartes: clientes e fornecedores.
-- -----------------------------------------------------------------------------
create table public.counterparties (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  tax_id       text,                                     -- CNPJ ou CPF, so digitos
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint counterparties_tax_id_digits
    check (tax_id is null or tax_id ~ '^([0-9]{11}|[0-9]{14})$')
);

create index counterparties_company_idx on public.counterparties (company_id, is_active);
create unique index counterparties_company_tax_id_key
  on public.counterparties (company_id, tax_id) where tax_id is not null;

-- -----------------------------------------------------------------------------
-- Centros de custo / projetos.
-- -----------------------------------------------------------------------------
create table public.cost_centers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, name)
);

create trigger bank_accounts_touch before update on public.bank_accounts
  for each row execute function app.touch_updated_at();
create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();
create trigger counterparties_touch before update on public.counterparties
  for each row execute function app.touch_updated_at();
create trigger cost_centers_touch before update on public.cost_centers
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Chaves compostas (id, company_id).
--
-- Existem para que as tabelas de movimento referenciem cadastros por chave
-- composta. Assim o Postgres garante, de forma declarativa, que um lancamento da
-- empresa A jamais aponte para uma conta ou categoria da empresa B — vazamento
-- entre clientes vira erro de integridade, nao depende de acerto no codigo.
-- -----------------------------------------------------------------------------
alter table public.bank_accounts  add constraint bank_accounts_id_company_key  unique (id, company_id);
alter table public.categories     add constraint categories_id_company_key     unique (id, company_id);
alter table public.counterparties add constraint counterparties_id_company_key unique (id, company_id);
alter table public.cost_centers   add constraint cost_centers_id_company_key   unique (id, company_id);
