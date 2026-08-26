-- =============================================================================
-- Contabiliza quantas vezes cada regra aprendida realmente foi usada.
--
-- `matching_rules.hit_count` existe desde a migration de conciliacao, mas
-- nunca era incrementado — o sistema aplicava a regra (via `categorize()`,
-- no cliente) sem nunca saber quantas vezes cada regra "acertou". Sem esse
-- numero, nao da pra saber quais regras valem a pena manter e quais viraram
-- lixo acumulado depois que o fornecedor mudou de nome no extrato.
--
-- `create_transaction_from_line` e recriada (drop + create) porque o
-- parametro novo muda a assinatura da funcao — sem o drop, ficariam duas
-- funcoes co-existindo (a antiga com 3 argumentos, a nova com 4), e o
-- PostgREST resolveria pra uma ou outra dependendo de quais campos o
-- cliente mandar. Mais previsivel ter uma unica versao.
-- =============================================================================

drop function if exists public.create_transaction_from_line(uuid, uuid, text);

create or replace function public.create_transaction_from_line(
  p_line_id     uuid,
  p_category_id uuid default null,
  p_description text default null,
  -- Regra que sugeriu p_category_id, quando a categoria veio de uma regra
  -- aprendida em vez de escolha manual. Nulo e o caso normal (sem regra
  -- aplicada, ou categoria escolhida a mao) e nao incrementa nada.
  p_rule_id     uuid default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_line public.statement_lines;
  v_transaction public.transactions;
  v_description text;
begin
  select * into v_line from public.statement_lines where id = p_line_id;
  if not found then
    raise exception 'Linha do extrato nao encontrada.';
  end if;
  if v_line.status <> 'pendente' then
    raise exception 'Esta linha ja foi tratada.';
  end if;

  if app.is_period_locked(v_line.company_id, v_line.posted_at) then
    raise exception 'O mes de % esta fechado. Reabra o fechamento para lancar esta linha.',
      to_char(v_line.posted_at, 'MM/YYYY');
  end if;

  v_description := coalesce(
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(v_line.memo, '')), ''),
    'Movimento sem descricao'
  );

  insert into public.transactions (
    company_id, bank_account_id, category_id,
    booking_date, competence_date, amount, description,
    reconciliation, created_by
  )
  values (
    v_line.company_id, v_line.bank_account_id, p_category_id,
    v_line.posted_at, v_line.posted_at, v_line.amount, v_description,
    'conciliado', auth.uid()
  )
  returning * into v_transaction;

  -- Melhor esforco: se a regra nao existir, nao pertencer a mesma empresa,
  -- ou o chamador nao tiver papel pra escrever em matching_rules (RLS),
  -- o UPDATE afeta 0 linhas e simplesmente nao conta o acerto — nao e
  -- motivo pra desfazer a criacao do lancamento, que ja aconteceu.
  if p_rule_id is not null then
    update public.matching_rules
    set hit_count = hit_count + 1
    where id = p_rule_id and company_id = v_line.company_id;
  end if;

  update public.statement_lines
  set status = 'criada',
      matched_transaction_id = v_transaction.id,
      matched_at = now(),
      matched_by = auth.uid()
  where id = p_line_id and status = 'pendente';

  if not found then
    raise exception 'Nao foi possivel atualizar a linha do extrato.';
  end if;

  return v_transaction;
end;
$$;

grant execute on function public.create_transaction_from_line(uuid, uuid, text, uuid) to authenticated;
