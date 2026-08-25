-- =============================================================================
-- Importacao de extrato e conciliacao bancaria.
--
-- O parser (OFX ou CSV) normaliza tudo para o mesmo formato canonico antes de
-- gravar aqui. Uma origem nova — Open Finance, por exemplo — entra como mais um
-- valor de `source`, sem tocar no schema.
-- =============================================================================

create type app.statement_source as enum ('ofx', 'csv', 'manual', 'open_finance');
create type app.statement_line_status as enum (
  'pendente',     -- ainda nao tratada
  'conciliada',   -- casada com um lancamento existente
  'criada',       -- virou lancamento novo a partir da propria linha
  'ignorada'      -- descartada de proposito (ex.: ja lancada em outra conta)
);

create table public.statement_imports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  bank_account_id  uuid not null,
  source           app.statement_source not null,
  file_name        text,
  file_hash        text,                                 -- sha-256 do arquivo
  period_start     date,
  period_end       date,
  -- Saldo final informado pelo proprio banco no arquivo (LEDGERBAL do OFX).
  -- E contra ele que o sistema prova que o saldo bate.
  statement_balance      numeric(14,2),
  statement_balance_date date,
  line_count       int not null default 0,
  imported_by      uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  constraint statement_imports_bank_account_fk
    foreign key (bank_account_id, company_id)
    references public.bank_accounts (id, company_id) on delete cascade
);

-- Reimportar o mesmo arquivo na mesma conta nao cria um segundo import.
create unique index statement_imports_file_hash_key
  on public.statement_imports (bank_account_id, file_hash)
  where file_hash is not null;

create table public.statement_lines (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  import_id             uuid not null references public.statement_imports (id) on delete cascade,
  bank_account_id       uuid not null,
  posted_at             date not null,
  amount                numeric(14,2) not null check (amount <> 0),
  memo                  text not null default '',
  fitid                 text,                            -- id da transacao no OFX
  -- Chave de deduplicacao: o FITID quando existe; senao um hash de
  -- data+valor+memo+ocorrencia. A ocorrencia entra no hash porque dois
  -- pagamentos identicos no mesmo dia sao legitimos e nao podem colidir.
  dedup_key             text not null,
  status                app.statement_line_status not null default 'pendente',
  matched_transaction_id uuid references public.transactions (id) on delete set null,
  matched_at            timestamptz,
  matched_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  constraint statement_lines_bank_account_fk
    foreign key (bank_account_id, company_id)
    references public.bank_accounts (id, company_id) on delete cascade,
  constraint statement_lines_matched_requires_transaction
    check (status <> 'conciliada' or matched_transaction_id is not null)
);

-- A garantia de que reimportar extrato nunca duplica movimento.
create unique index statement_lines_dedup_key
  on public.statement_lines (bank_account_id, dedup_key);
create index statement_lines_pending_idx
  on public.statement_lines (company_id, bank_account_id, posted_at)
  where status = 'pendente';
create unique index statement_lines_matched_transaction_key
  on public.statement_lines (matched_transaction_id)
  where matched_transaction_id is not null;

-- -----------------------------------------------------------------------------
-- Regras aprendidas de categorizacao.
--
-- Ao conciliar, o sistema oferece guardar "memo contem X -> categoria Y". Da
-- proxima importacao em diante ele ja chega categorizado. E o que faz a
-- conciliacao ficar mais rapida a cada mes em vez de sempre custar o mesmo.
-- -----------------------------------------------------------------------------
create table public.matching_rules (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  -- Texto procurado no memo do extrato, sem acento e em minusculas.
  match_text       text not null check (length(btrim(match_text)) > 0),
  bank_account_id  uuid,                                 -- nulo = vale para todas
  direction        app.transaction_direction,            -- nulo = vale para os dois
  category_id      uuid,
  counterparty_id  uuid,
  cost_center_id   uuid,
  priority         int not null default 100,             -- menor roda primeiro
  hit_count        int not null default 0,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint matching_rules_category_fk
    foreign key (category_id, company_id)
    references public.categories (id, company_id) on delete cascade,
  constraint matching_rules_counterparty_fk
    foreign key (counterparty_id, company_id)
    references public.counterparties (id, company_id) on delete cascade,
  constraint matching_rules_cost_center_fk
    foreign key (cost_center_id, company_id)
    references public.cost_centers (id, company_id) on delete cascade,
  constraint matching_rules_bank_account_fk
    foreign key (bank_account_id, company_id)
    references public.bank_accounts (id, company_id) on delete cascade,
  constraint matching_rules_does_something
    check (category_id is not null or counterparty_id is not null or cost_center_id is not null)
);

create index matching_rules_lookup_idx
  on public.matching_rules (company_id, priority) where is_active;

create trigger matching_rules_touch before update on public.matching_rules
  for each row execute function app.touch_updated_at();
