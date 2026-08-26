-- =============================================================================
-- Ações atômicas de conciliação.
--
-- `statement_lines` e `transactions` são atualizadas em conjunto para toda
-- decisão de conciliação — confirmar, desfazer ou criar lançamento a partir da
-- linha. Sem uma função só para isso, o cliente faz dois UPDATEs separados: se
-- o segundo falhar, a linha fica "conciliada" apontando para um lançamento que
-- continua "nao_conciliado". Cada função abaixo roda como uma unica transacao
-- implicita do Postgres, e RAISE EXCEPTION desfaz tudo.
--
-- SECURITY INVOKER (o padrao, mas explicito aqui): quem chama precisa ter,
-- por si só, permissão de UPDATE/INSERT nas tabelas tocadas — a mesma policy
-- de RLS que já vale para a escrita direta. Isso é diferente de
-- `public.create_company`, que é SECURITY DEFINER porque resolve um
-- ovo-e-galinha (criar o primeiro vínculo antes de ele existir); aqui o
-- vínculo (membership com papel assistente) já existe antes da chamada.
-- =============================================================================

-- `packages/statements` ja normaliza PDF para o mesmo StatementSource
-- canonico ("ofx" | "csv" | "pdf" | "open_finance"), mas o enum do banco
-- ainda nao tinha 'pdf' — o leitor do Cora existia e nunca podia ser
-- importado, porque a gravacao em statement_imports.source falharia.
alter type app.statement_source add value if not exists 'pdf';

-- Sem o motivo, "ignorada" vira uma decisao sem rastro — e auditoria e boa
-- parte do motivo de sair da planilha.
alter table public.statement_lines
  add column ignored_reason text;

alter table public.statement_lines
  add constraint statement_lines_ignored_requires_reason
  check (status <> 'ignorada' or length(btrim(coalesce(ignored_reason, ''))) > 0);

-- -----------------------------------------------------------------------------
-- Confirma o pareamento sugerido: linha do extrato <-> lancamento existente.
-- -----------------------------------------------------------------------------
create or replace function public.reconcile_line(p_line_id uuid, p_transaction_id uuid)
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
  if v_line.status <> 'pendente' then
    raise exception 'Esta linha ja foi tratada.';
  end if;

  select * into v_transaction from public.transactions where id = p_transaction_id;
  if not found then
    raise exception 'Lancamento nao encontrado.';
  end if;
  if v_transaction.bank_account_id <> v_line.bank_account_id then
    raise exception 'O lancamento escolhido nao pertence a mesma conta bancaria.';
  end if;
  if v_transaction.reconciliation = 'conciliado' then
    raise exception 'Este lancamento ja esta conciliado.';
  end if;

  update public.statement_lines
  set status = 'conciliada',
      matched_transaction_id = p_transaction_id,
      matched_at = now(),
      matched_by = auth.uid()
  where id = p_line_id and status = 'pendente';

  if not found then
    raise exception 'Nao foi possivel atualizar a linha do extrato.';
  end if;

  update public.transactions
  set reconciliation = 'conciliado'
  where id = p_transaction_id and reconciliation = 'nao_conciliado';

  if not found then
    raise exception 'Nao foi possivel atualizar o lancamento.';
  end if;
end;
$$;

grant execute on function public.reconcile_line(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Desfaz uma conciliacao: linha volta a pendente, lancamento volta a
-- nao_conciliado. Nao desfaz uma linha "criada" — o lancamento que ela gerou
-- continua existindo e precisa ser excluido pela tela de lancamentos, que ja
-- tem essa acao e a auditoria correspondente.
-- -----------------------------------------------------------------------------
create or replace function public.unreconcile_line(p_line_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_line public.statement_lines;
begin
  select * into v_line from public.statement_lines where id = p_line_id;
  if not found then
    raise exception 'Linha do extrato nao encontrada.';
  end if;
  if v_line.status <> 'conciliada' then
    raise exception 'Esta linha nao esta conciliada.';
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
  end if;
end;
$$;

grant execute on function public.unreconcile_line(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Cria um lancamento a partir de uma linha do extrato sem par no sistema —
-- o caso mais comum numa primeira importacao. O lancamento nasce ja
-- conciliado: ele existe porque a linha do extrato existe, entao a
-- conferencia entre os dois lados ja esta feita pela propria criacao.
-- -----------------------------------------------------------------------------
create or replace function public.create_transaction_from_line(
  p_line_id     uuid,
  p_category_id uuid default null,
  p_description text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_line public.statement_lines;
  v_transaction public.transactions;
  -- description tem check de nao-vazio; sem descricao explicita, usa o memo
  -- do extrato, e so na falta dos dois um rotulo generico. Calculado antes do
  -- INSERT porque a coluna e NOT NULL: passar NULL falharia ali mesmo, com um
  -- erro de constraint cru em vez desta mensagem previsivel.
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

grant execute on function public.create_transaction_from_line(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Ignora uma linha de proposito (ex.: ja lancada em outra conta). Precisa de
-- motivo — a constraint de cima ja garante isso no banco.
-- -----------------------------------------------------------------------------
create or replace function public.ignore_line(p_line_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Informe o motivo para ignorar esta linha.';
  end if;

  update public.statement_lines
  set status = 'ignorada', ignored_reason = btrim(p_reason)
  where id = p_line_id and status = 'pendente';

  if not found then
    raise exception 'Esta linha ja foi tratada ou nao foi encontrada.';
  end if;
end;
$$;

grant execute on function public.ignore_line(uuid, text) to authenticated;
