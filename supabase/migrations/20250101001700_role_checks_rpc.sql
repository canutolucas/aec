-- =============================================================================
-- Checagem de papel explicita em close_month, reopen_month e settle_invoices.
--
-- As tres ja eram protegidas por RLS (monthly_closings_write e
-- invoice_settlements_insert exigem 'contador'/'assistente'), mas nenhuma
-- checava o papel por conta propria antes de escrever -- um cliente_leitura
-- chamando close_month, por exemplo, so descobria que nao pode quando o
-- INSERT em monthly_closings esbarrava na policy, e a mensagem que sobe do
-- Postgres nesse caso e generica ("new row violates row-level security
-- policy..."), nao a frase clara em portugues que e a convencao do resto
-- deste arquivo de RPCs. Mesmo padrao ja usado em add_member (checagem de
-- papel e a PRIMEIRA coisa na funcao, antes de qualquer leitura ou escrita).
-- =============================================================================

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
  if not app.has_role(p_company_id, 'contador') then
    raise exception 'Apenas contador ou responsavel pode fechar o mes.';
  end if;

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
  if not app.has_role(p_company_id, 'contador') then
    raise exception 'Apenas contador ou responsavel pode reabrir o mes.';
  end if;

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

-- -----------------------------------------------------------------------------
-- settle_invoices: p_company_id nao e parametro -- vem do proprio lancamento
-- (p_transaction_id). A checagem de papel so pode entrar depois de achar o
-- lancamento e sua empresa, mas ainda assim ANTES de qualquer outra regra de
-- negocio (status, mes fechado, alocacoes) -- quem nao tem papel de
-- assistente na empresa do lancamento nao deveria aprender nada sobre ele
-- alem de "nao encontrado" / "sem permissao".
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

  if not app.has_role(v_transaction.company_id, 'assistente') then
    raise exception 'Seu perfil nao pode dar baixa em recebimentos nesta empresa.';
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
