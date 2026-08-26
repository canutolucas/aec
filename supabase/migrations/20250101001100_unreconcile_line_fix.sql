-- =============================================================================
-- Corrige um desalinhamento real em unreconcile_line().
--
-- Toda outra escrita nesta funcao e em reconcile_line() checa
-- `if not found then raise exception` depois do UPDATE — exceto a ultima,
-- em transactions. Se o mes do lancamento tiver sido fechado depois da
-- conciliacao (close_month bloqueia updates via RLS por
-- app.is_period_locked), esse UPDATE e silenciosamente recusado: a linha
-- do extrato ja foi devolvida a "pendente" — a funcao nao reverte isso,
-- porque ainda nao tinha erro nenhum quando aquele UPDATE aconteceu — e o
-- lancamento fica preso em reconciliation = 'conciliado', sem nenhuma
-- linha apontando pra ele. Exatamente a inconsistencia entre as duas
-- tabelas que esta migration inteira existe para impedir.
--
-- A correcao verifica o fechamento de mes ANTES de tocar em qualquer
-- tabela (como create_transaction_from_line ja faz), com mensagem clara
-- em vez de deixar a RLS falhar silenciosamente no meio da funcao.
-- =============================================================================

create or replace function public.unreconcile_line(p_line_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_line public.statement_lines;
  v_transaction public.transactions;
begin
  select * into v_line from public.statement_lines where id = p_line_id;
  if not found then
    raise exception 'Linha do extrato nao encontrada.';
  end if;
  if v_line.status <> 'conciliada' then
    raise exception 'Esta linha nao esta conciliada.';
  end if;

  if v_line.matched_transaction_id is not null then
    select * into v_transaction from public.transactions where id = v_line.matched_transaction_id;
    if found and app.is_period_locked(v_transaction.company_id, v_transaction.booking_date) then
      raise exception 'O mes de % esta fechado. Reabra o fechamento para desfazer esta conciliacao.',
        to_char(v_transaction.booking_date, 'MM/YYYY');
    end if;
  end if;

  update public.statement_lines
  set status = 'pendente',
      matched_transaction_id = null,
      matched_at = null,
      matched_by = null
  where id = p_line_id and status = 'conciliada';

  if not found then
    raise exception 'Nao foi possivel atualizar a linha do extrato.';
  end if;

  if v_line.matched_transaction_id is not null then
    update public.transactions
    set reconciliation = 'nao_conciliado'
    where id = v_line.matched_transaction_id and reconciliation = 'conciliado';

    if not found then
      raise exception 'Nao foi possivel atualizar o lancamento.';
    end if;
  end if;
end;
$$;
