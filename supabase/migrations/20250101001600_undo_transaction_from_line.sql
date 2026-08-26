-- =============================================================================
-- Desfaz um lancamento criado a partir de uma linha de extrato
-- (create_transaction_from_line) — o "desfazer categorizacao" do fluxo
-- simples.
--
-- unreconcile_line() JA existe, mas resolve um caso diferente: ela so aceita
-- status = 'conciliada' (linha pareada com um lancamento JA EXISTENTE).
-- create_transaction_from_line() deixa a linha em status = 'criada' (um
-- lancamento NOVO, que nao existia antes) — sem esta funcao, nao havia
-- nenhum caminho para desfazer esse caso.
-- =============================================================================

create or replace function public.undo_transaction_from_line(p_line_id uuid)
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
  if v_line.status <> 'criada' or v_line.matched_transaction_id is null then
    raise exception 'Esta linha nao tem um lancamento criado para desfazer.';
  end if;

  select * into v_transaction from public.transactions where id = v_line.matched_transaction_id;
  if not found then
    raise exception 'Lancamento nao encontrado.';
  end if;
  if app.is_period_locked(v_transaction.company_id, v_transaction.booking_date) then
    raise exception 'O mes de % esta fechado. Reabra o fechamento para desfazer este lancamento.',
      to_char(v_transaction.booking_date, 'MM/YYYY');
  end if;

  -- Um lancamento que ja recebeu baixa de nota fiscal (invoice_settlements)
  -- nao pode ser apagado direto: a FK e "on delete cascade", entao apagar o
  -- lancamento apagaria a baixa junto, sem passar pelo recalculo de status
  -- da nota que unsettle_invoice() faz. Quem quiser desfazer isso primeiro
  -- desfaz a baixa em Recebimentos.
  if exists (select 1 from public.invoice_settlements where transaction_id = v_transaction.id) then
    raise exception 'Este lancamento ja tem baixa de nota fiscal — desfaca a baixa em Recebimentos antes de desfazer o lancamento.';
  end if;

  update public.statement_lines
  set status = 'pendente', matched_transaction_id = null, matched_at = null, matched_by = null
  where id = p_line_id and status = 'criada';

  if not found then
    raise exception 'Nao foi possivel atualizar a linha do extrato.';
  end if;

  delete from public.transactions where id = v_transaction.id;
  if not found then
    raise exception 'Nao foi possivel apagar o lancamento.';
  end if;
end;
$$;

grant execute on function public.undo_transaction_from_line(uuid) to authenticated;
