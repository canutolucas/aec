-- =============================================================================
-- Faturamento: notas fiscais emitidas (NFS-e, por enquanto) e a baixa dos
-- recebimentos correspondentes.
--
-- Uma nota NAO nasce presa a uma conta bancaria: o recebimento pode cair em
-- qualquer banco (Cora na maioria, mas nao so) e so se sabe qual depois que o
-- extrato chega, no mes seguinte. Por isso isto e modelado como duas tabelas
-- novas -- invoices e invoice_settlements -- e nao como um lancamento
-- (transactions.bank_account_id e NOT NULL, e settle_transaction so
-- atualiza uma linha no lugar, sem suportar N notas por um recebimento nem
-- um recebimento repartido entre N notas).
--
-- invoice_settlements e o vinculo muitos-para-muitos que resolve os tres casos
-- reais confirmados pela usuaria: retencao de imposto (recebe menos que a
-- nota), um PIX que quita varias notas de uma vez, e uma nota paga em
-- parcelas.
-- =============================================================================

create type app.invoice_status as enum ('aberta', 'recebida_parcial', 'recebida', 'cancelada');

create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  number             text not null check (length(btrim(number)) > 0),
  series             text,
  verification_code  text,
  -- Emissao = competencia da nota (regime de competencia). O recebimento (o
  -- lado caixa) mora nos lancamentos vinculados via invoice_settlements.
  issued_on          date not null,
  -- Vencimento esperado do recebimento -- normalmente o mes seguinte a
  -- emissao, conforme a usuaria descreveu; nao e travado pelo sistema, so
  -- informativo (alimenta relatorio, nao bloqueia nada).
  due_on             date,
  amount             numeric(14,2) not null check (amount > 0),
  -- Retencoes que o proprio XML ja declara (IR/CSLL/PIS/COFINS/INSS/ISS
  -- retido), quando o parser encontra. So informativo: o calculo de quanto
  -- falta receber usa invoice_settlements, nunca este campo.
  withheld_amount    numeric(14,2) not null default 0 check (withheld_amount >= 0),
  counterparty_id    uuid,
  -- Nome e CNPJ/CPF como vieram NO XML -- nao depende de counterparty_id
  -- existir, exatamente como statement_lines.memo nao depende de nenhum
  -- cadastro para a linha existir.
  client_name        text not null check (length(btrim(client_name)) > 0),
  client_tax_id      text,
  status             app.invoice_status not null default 'aberta',
  source_file_name   text,
  created_by         uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint invoices_counterparty_fk
    foreign key (counterparty_id, company_id)
    references public.counterparties (id, company_id) on delete set null,
  constraint invoices_client_tax_id_digits
    check (client_tax_id is null or client_tax_id ~ '^([0-9]{11}|[0-9]{14})$')
);

-- Reimportar o mesmo XML (a pessoa arrasta a pasta duas vezes por engano) nao
-- pode duplicar a nota -- o mesmo raciocinio do dedup_key em statement_lines,
-- so que aqui a chave natural e numero+serie, nao um hash de conteudo.
create unique index invoices_dedup_idx
  on public.invoices (company_id, number, coalesce(series, ''));

create index invoices_counterparty_idx on public.invoices (company_id, counterparty_id);
create index invoices_client_tax_id_idx on public.invoices (company_id, client_tax_id);
create index invoices_status_idx on public.invoices (company_id, status);

-- invoices precisa de uma chave composta (id, company_id) para as FKs
-- compostas de invoice_settlements poderem apontar para ela, no mesmo padrao
-- que bank_accounts/categories/counterparties ja usam.
alter table public.invoices add constraint invoices_id_company_unique unique (id, company_id);

create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Cada linha diz QUANTO de UM lancamento (o recebimento, ja realizado no
-- banco) quitou DE UMA nota. Uma nota pode ter varias linhas (parcelado); um
-- lancamento pode ter varias linhas (um PIX quitando duas notas de uma vez).
-- -----------------------------------------------------------------------------
create table public.invoice_settlements (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  invoice_id     uuid not null,
  -- Sem FK composta (id, company_id) aqui: `transactions` nunca ganhou esse
  -- unique -- toda referencia existente a ela (attachments.transaction_id,
  -- statement_lines.matched_transaction_id) ja usa FK simples por id, e a
  -- consistencia entre empresas fica por conta de quem escreve (aqui,
  -- settle_invoices confere v_transaction.company_id explicitamente antes
  -- de inserir).
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  amount         numeric(14,2) not null check (amount > 0),
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  constraint invoice_settlements_invoice_fk
    foreign key (invoice_id, company_id)
    references public.invoices (id, company_id) on delete cascade,
  unique (invoice_id, transaction_id)
);

create index invoice_settlements_invoice_idx on public.invoice_settlements (invoice_id);
create index invoice_settlements_transaction_idx on public.invoice_settlements (transaction_id);

create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function app.write_audit_log();

create trigger invoice_settlements_audit
  after insert or update or delete on public.invoice_settlements
  for each row execute function app.write_audit_log();

-- -----------------------------------------------------------------------------
-- Saldo em aberto de cada nota, derivado da soma dos settlements -- nunca
-- guardado, no mesmo espirito de v_account_balances (que tambem deriva saldo
-- de opening_balance + movimento em vez de armazena-lo).
-- -----------------------------------------------------------------------------
create view public.v_invoice_balances
with (security_invoker = on) as
select
  i.id                as invoice_id,
  i.company_id,
  i.number,
  i.series,
  i.issued_on,
  i.due_on,
  i.amount,
  i.withheld_amount,
  i.client_name,
  i.client_tax_id,
  i.counterparty_id,
  i.status,
  coalesce(sum(s.amount), 0)              as received_amount,
  i.amount - coalesce(sum(s.amount), 0)    as outstanding_amount
from public.invoices i
left join public.invoice_settlements s on s.invoice_id = i.id
group by i.id;

-- -----------------------------------------------------------------------------
-- RLS: mesmo modelo de transactions -- leitura para qualquer membro,
-- escrita a partir de assistente. Nao ha checagem de mes fechado aqui (a
-- nota em si nao tem "mes" no sentido de fechamento de caixa); quem trava
-- por mes fechado e settle_invoices, sobre o LANCAMENTO do recebimento.
-- -----------------------------------------------------------------------------
alter table public.invoices             enable row level security;
alter table public.invoice_settlements  enable row level security;

create policy invoices_select on public.invoices
  for select to authenticated
  using (app.is_member(company_id));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (app.has_role(company_id, 'assistente'));

create policy invoices_update on public.invoices
  for update to authenticated
  using (app.has_role(company_id, 'assistente'))
  with check (app.has_role(company_id, 'assistente'));

create policy invoices_delete on public.invoices
  for delete to authenticated
  using (app.has_role(company_id, 'assistente'));

create policy invoice_settlements_select on public.invoice_settlements
  for select to authenticated
  using (app.is_member(company_id));

-- Escrita em invoice_settlements so acontece via settle_invoices/
-- unsettle_invoice (SECURITY INVOKER, abaixo) -- ainda assim a policy exige
-- papel minimo, para o RLS proteger mesmo se algum caminho novo tentasse
-- escrever direto na tabela um dia.
create policy invoice_settlements_insert on public.invoice_settlements
  for insert to authenticated
  with check (app.has_role(company_id, 'assistente'));

create policy invoice_settlements_delete on public.invoice_settlements
  for delete to authenticated
  using (app.has_role(company_id, 'assistente'));

-- A migration que faz `grant ... on all tables in schema public to
-- authenticated` (20250101000700_rls.sql) so alcanca as tabelas que ja
-- existiam quando ela rodou -- sem estes GRANTs explicitos aqui, toda policy
-- acima seria irrelevante: o Postgres nega o acesso na checagem de
-- privilegio de tabela, antes mesmo de chegar a avaliar RLS.
grant select, insert, update, delete on public.invoices             to authenticated;
grant select, insert, update, delete on public.invoice_settlements  to authenticated;
grant select on public.v_invoice_balances to authenticated;

-- -----------------------------------------------------------------------------
-- Baixa de recebimento: um lancamento (o credito ja realizado no banco)
-- quita uma ou mais notas de uma vez. p_allocations e um array JSON
-- [{"invoice_id": "...", "amount": 123.45}, ...].
--
-- E uma unica RPC (nao um loop de chamadas independentes, diferente do
-- autoApplyReconciliation do lado de conciliacao de extrato) porque as
-- alocacoes de UM MESMO recebimento tem que valer todas ou nenhuma -- se
-- metade gravasse e a outra metade falhasse, o credito ficaria alocado pela
-- metade sem ninguem perceber.
-- -----------------------------------------------------------------------------
create or replace function public.settle_invoices(
  p_transaction_id uuid,
  p_allocations    jsonb
)
returns setof public.invoice_settlements
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_transaction   public.transactions;
  v_allocation    record;
  v_invoice       public.invoices;
  v_outstanding   numeric(14,2);
  v_total_alloc   numeric(14,2) := 0;
  v_row           public.invoice_settlements;
begin
  select * into v_transaction from public.transactions where id = p_transaction_id;
  if not found then
    raise exception 'Lancamento nao encontrado.';
  end if;
  if v_transaction.status <> 'realizado' then
    raise exception 'Somente um lancamento realizado pode quitar uma nota.';
  end if;
  if app.is_period_locked(v_transaction.company_id, v_transaction.booking_date) then
    raise exception 'O mes de % esta fechado. Reabra o fechamento para dar baixa neste recebimento.',
      to_char(v_transaction.booking_date, 'MM/YYYY');
  end if;

  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Informe ao menos uma nota para dar baixa.';
  end if;

  -- Primeira passada: valida tudo (soma nao passa do credito, nenhuma
  -- alocacao passa do saldo em aberto da propria nota) antes de gravar
  -- qualquer coisa -- e o que garante que as alocacoes valem todas ou
  -- nenhuma dentro desta unica transacao SQL.
  for v_allocation in select * from jsonb_to_recordset(p_allocations) as x(invoice_id uuid, amount numeric)
  loop
    if v_allocation.invoice_id is null or v_allocation.amount is null or v_allocation.amount <= 0 then
      raise exception 'Cada alocacao precisa de invoice_id e amount positivo.';
    end if;

    -- Sem FOR UPDATE de proposito: RLS trata um SELECT ... FOR UPDATE como
    -- uma escrita (o lock so passa se a linha TAMBEM satisfizer o USING da
    -- policy de UPDATE, nao so a de SELECT) -- um cliente_leitura (que so
    -- tem policy de SELECT) cairia aqui com "nota nao encontrada", uma
    -- mensagem enganosa que esconderia que o problema e falta de permissao,
    -- nao a nota nao existir. A escrita real (INSERT abaixo) ja e onde a
    -- RLS de invoice_settlements barra quem nao pode -- com a mensagem certa.
    select * into v_invoice
      from public.invoices
     where id = v_allocation.invoice_id and company_id = v_transaction.company_id;
    if not found then
      raise exception 'Nota nao encontrada nesta empresa.';
    end if;
    if v_invoice.status = 'cancelada' then
      raise exception 'A nota % esta cancelada e nao pode receber baixa.', v_invoice.number;
    end if;

    select v_invoice.amount - coalesce(sum(amount), 0) into v_outstanding
      from public.invoice_settlements where invoice_id = v_invoice.id;

    if v_allocation.amount > v_outstanding then
      raise exception 'A alocacao de % para a nota % passa do saldo em aberto (%).',
        v_allocation.amount, v_invoice.number, v_outstanding;
    end if;

    v_total_alloc := v_total_alloc + v_allocation.amount;
  end loop;

  if v_total_alloc > v_transaction.amount then
    raise exception 'A soma das alocacoes (%) passa do valor do lancamento (%).',
      v_total_alloc, v_transaction.amount;
  end if;

  -- Segunda passada: grava. Se qualquer coisa aqui falhar, a funcao inteira
  -- desfaz (comportamento padrao de excecao dentro de uma funcao SQL).
  for v_allocation in select * from jsonb_to_recordset(p_allocations) as x(invoice_id uuid, amount numeric)
  loop
    insert into public.invoice_settlements (company_id, invoice_id, transaction_id, amount, created_by)
    values (v_transaction.company_id, v_allocation.invoice_id, p_transaction_id, v_allocation.amount, auth.uid())
    returning * into v_row;

    update public.invoices i
       set status = case
             when i.amount <= (select coalesce(sum(amount), 0) from public.invoice_settlements where invoice_id = i.id)
               then 'recebida'::app.invoice_status
             else 'recebida_parcial'::app.invoice_status
           end
     where i.id = v_allocation.invoice_id;

    return next v_row;
  end loop;
end;
$$;

grant execute on function public.settle_invoices(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Desfaz uma baixa: apaga a linha e recalcula o status da nota. So por id da
-- propria linha (nao por invoice_id + transaction_id), para nao ter
-- ambiguidade se um dia a mesma nota/lancamento tiver mais de uma linha
-- historica (nao tem hoje, unique(invoice_id, transaction_id) impede, mas o
-- unique nao sobrevive a um settlement desfeito e refeito).
-- -----------------------------------------------------------------------------
create or replace function public.unsettle_invoice(p_settlement_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_settlement public.invoice_settlements;
  v_transaction public.transactions;
begin
  select * into v_settlement from public.invoice_settlements where id = p_settlement_id;
  if not found then
    raise exception 'Baixa nao encontrada.';
  end if;

  select * into v_transaction from public.transactions where id = v_settlement.transaction_id;
  if found and app.is_period_locked(v_transaction.company_id, v_transaction.booking_date) then
    raise exception 'O mes de % esta fechado. Reabra o fechamento para desfazer esta baixa.',
      to_char(v_transaction.booking_date, 'MM/YYYY');
  end if;

  delete from public.invoice_settlements where id = p_settlement_id;

  update public.invoices i
     set status = case
           when coalesce((select sum(amount) from public.invoice_settlements where invoice_id = i.id), 0) = 0
             then 'aberta'::app.invoice_status
           when i.amount <= (select coalesce(sum(amount), 0) from public.invoice_settlements where invoice_id = i.id)
             then 'recebida'::app.invoice_status
           else 'recebida_parcial'::app.invoice_status
         end
   where i.id = v_settlement.invoice_id
     and i.status <> 'cancelada';
end;
$$;

grant execute on function public.unsettle_invoice(uuid) to authenticated;
