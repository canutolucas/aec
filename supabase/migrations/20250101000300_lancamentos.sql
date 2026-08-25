-- =============================================================================
-- Lancamentos — o coracao do sistema.
--
-- Tabela unica para realizado e previsto. Contas a pagar e a receber SAO
-- lancamentos com status 'previsto'; ao dar baixa, viram 'realizado'. Assim o
-- fluxo de caixa projetado sai da mesma tabela do realizado, sem estrutura
-- paralela que sai de sincronia.
-- =============================================================================

create type app.transaction_status as enum ('previsto', 'realizado');
create type app.transaction_direction as enum ('entrada', 'saida');
create type app.reconciliation_status as enum ('nao_conciliado', 'conciliado', 'ignorado');
create type app.payment_method as enum (
  'pix', 'ted', 'doc', 'boleto', 'debito_automatico', 'cartao', 'dinheiro', 'cheque', 'outro'
);

create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  bank_account_id       uuid not null,
  category_id           uuid,
  counterparty_id       uuid,
  cost_center_id        uuid,

  -- Data de caixa: quando o dinheiro entra ou sai. Para previstos, o vencimento.
  -- Deliberadamente `date` e nao `timestamptz`: horario nao existe em extrato
  -- bancario, e guardar como timestamp reintroduz o bug classico de fuso em que o
  -- lancamento do dia 1o aparece no dia 31 do mes anterior.
  booking_date          date not null,
  -- Data de competencia, para a visao por regime de competencia.
  competence_date       date not null,

  -- Valor com sinal: positivo entra, negativo sai. numeric(14,2) — float jamais
  -- toca dinheiro. Uma coluna so evita o par (valor, tipo) sair de sincronia.
  amount                numeric(14,2) not null check (amount <> 0),
  direction             app.transaction_direction
                          generated always as (
                            case when amount > 0 then 'entrada'::app.transaction_direction
                                 else 'saida'::app.transaction_direction end
                          ) stored,

  status                app.transaction_status not null default 'realizado',
  reconciliation        app.reconciliation_status not null default 'nao_conciliado',
  payment_method        app.payment_method,

  description           text not null check (length(btrim(description)) > 0),
  document_number       text,
  notes                 text,

  -- Os dois lados de uma transferencia compartilham este id.
  transfer_group_id     uuid,
  is_transfer           boolean generated always as (transfer_group_id is not null) stored,

  recurrence_id         uuid,
  -- Preenchido quando o lancamento nasceu da baixa de um previsto.
  settles_transaction_id uuid references public.transactions (id) on delete set null,

  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Chaves compostas: garantem no banco que conta, categoria, contraparte e
  -- centro de custo pertencem a MESMA empresa do lancamento.
  constraint transactions_bank_account_fk
    foreign key (bank_account_id, company_id)
    references public.bank_accounts (id, company_id) on delete restrict,
  constraint transactions_category_fk
    foreign key (category_id, company_id)
    references public.categories (id, company_id) on delete restrict,
  constraint transactions_counterparty_fk
    foreign key (counterparty_id, company_id)
    references public.counterparties (id, company_id) on delete restrict,
  constraint transactions_cost_center_fk
    foreign key (cost_center_id, company_id)
    references public.cost_centers (id, company_id) on delete restrict,

  -- Transferencia e movimento entre contas proprias: nao tem categoria de
  -- resultado, nao e receita nem despesa.
  constraint transactions_transfer_has_no_category
    check (transfer_group_id is null or category_id is null)
);

-- Indice principal: quase toda consulta e "conta X, periodo Y, realizados".
create index transactions_account_date_idx
  on public.transactions (company_id, bank_account_id, booking_date, status);
create index transactions_company_date_idx
  on public.transactions (company_id, booking_date desc);
create index transactions_competence_idx
  on public.transactions (company_id, competence_date);
create index transactions_pending_idx
  on public.transactions (company_id, status, booking_date)
  where status = 'previsto';
create index transactions_unreconciled_idx
  on public.transactions (company_id, bank_account_id, booking_date)
  where reconciliation = 'nao_conciliado' and status = 'realizado';
create index transactions_transfer_group_idx
  on public.transactions (transfer_group_id) where transfer_group_id is not null;
create index transactions_category_idx on public.transactions (category_id);
create index transactions_counterparty_idx on public.transactions (counterparty_id);

create trigger transactions_touch before update on public.transactions
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- A categoria escolhida tem de aceitar o sentido do lancamento: nao se classifica
-- uma saida em categoria de receita. E o erro de digitacao que mais suja
-- relatorio gerencial.
-- -----------------------------------------------------------------------------
create or replace function app.check_transaction_category()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_kind app.category_kind;
  -- Derivado do valor, e NAO lido de new.direction: em trigger BEFORE as colunas
  -- GENERATED ainda nao foram calculadas, entao new.direction chega nula e toda
  -- comparacao com ela daria nulo — a validacao passaria batido em silencio.
  v_direction text := case when new.amount > 0 then 'entrada' else 'saida' end;
begin
  if new.category_id is null then
    return new;
  end if;

  select kind into v_kind from public.categories where id = new.category_id;

  if v_kind <> 'ambos' and v_kind::text <> v_direction then
    raise exception
      'Categoria "%" aceita apenas lancamentos de %, mas este e uma %',
      (select name from public.categories where id = new.category_id), v_kind, v_direction
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger transactions_check_category
  before insert or update of category_id, amount on public.transactions
  for each row execute function app.check_transaction_category();

-- -----------------------------------------------------------------------------
-- Uma transferencia e sempre um par que se anula, entre duas contas distintas.
--
-- Trigger DEFERRABLE: a checagem roda no commit, para que os dois lados possam
-- ser inseridos na mesma transacao sem que o primeiro ja falhe sozinho.
-- E o que impede a dupla contagem que a planilha comete toda vez.
-- -----------------------------------------------------------------------------
create or replace function app.check_transfer_group()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_groups uuid[];
  v_group uuid;
  v_count int;
  v_sum numeric(14,2);
  v_accounts int;
begin
  v_groups := array_remove(
    case tg_op
      when 'INSERT' then array[new.transfer_group_id]
      when 'DELETE' then array[old.transfer_group_id]
      else array[old.transfer_group_id, new.transfer_group_id]
    end,
    null
  );

  foreach v_group in array v_groups loop
    select count(*), coalesce(sum(amount), 0), count(distinct bank_account_id)
      into v_count, v_sum, v_accounts
      from public.transactions
     where transfer_group_id = v_group;

    -- Grupo inteiro removido: nada a validar.
    if v_count = 0 then
      continue;
    end if;

    if v_count <> 2 then
      raise exception 'Transferencia deve ter exatamente 2 lancamentos, encontrou %', v_count
        using errcode = 'check_violation';
    end if;

    if v_sum <> 0 then
      raise exception 'Os dois lados da transferencia nao se anulam (soma %)', v_sum
        using errcode = 'check_violation';
    end if;

    if v_accounts <> 2 then
      raise exception 'Transferencia deve envolver duas contas bancarias distintas'
        using errcode = 'check_violation';
    end if;
  end loop;

  return null;
end;
$$;

create constraint trigger transactions_check_transfer_group
  after insert or update or delete on public.transactions
  deferrable initially deferred
  for each row execute function app.check_transfer_group();
