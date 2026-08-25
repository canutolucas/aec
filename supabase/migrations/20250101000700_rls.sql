-- =============================================================================
-- Row Level Security.
--
-- O isolamento entre empresas mora aqui, no banco, e nao em filtros espalhados
-- pelo codigo. Uma consulta que esqueca o `where company_id = ...` devolve zero
-- linhas em vez de vazar dados de outro cliente. A trava de mes fechado usa o
-- mesmo mecanismo: e uma policy de escrita, nao um `if` no front.
--
-- Regra do UPDATE em RLS: USING avalia a linha ANTES, WITH CHECK avalia a linha
-- DEPOIS. As duas precisam da checagem de periodo, senao daria para arrastar um
-- lancamento para dentro ou para fora de um mes travado.
-- =============================================================================

alter table public.companies                 enable row level security;
alter table public.profiles                  enable row level security;
alter table public.memberships               enable row level security;
alter table public.bank_accounts             enable row level security;
alter table public.categories                enable row level security;
alter table public.counterparties            enable row level security;
alter table public.cost_centers              enable row level security;
alter table public.transactions              enable row level security;
alter table public.statement_imports         enable row level security;
alter table public.statement_lines           enable row level security;
alter table public.matching_rules            enable row level security;
alter table public.recurrences               enable row level security;
alter table public.monthly_closings          enable row level security;
alter table public.monthly_closing_balances  enable row level security;
alter table public.attachments               enable row level security;
alter table public.audit_log                 enable row level security;

-- -----------------------------------------------------------------------------
-- Empresas e perfis
-- -----------------------------------------------------------------------------
create policy companies_select on public.companies
  for select to authenticated
  using (app.is_member(id));

create policy companies_update on public.companies
  for update to authenticated
  using (app.has_role(id, 'owner'))
  with check (app.has_role(id, 'owner'));

-- Nao ha policy de INSERT: criar empresa e vinculo de dono na mesma transacao
-- so acontece por public.create_company(), definida no fim deste arquivo.

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.memberships mine
      join public.memberships theirs on theirs.company_id = mine.company_id
      where mine.user_id = auth.uid()
        and theirs.user_id = public.profiles.id
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy memberships_select on public.memberships
  for select to authenticated
  using (app.is_member(company_id));

create policy memberships_write on public.memberships
  for all to authenticated
  using (app.has_role(company_id, 'owner'))
  with check (app.has_role(company_id, 'owner'));

-- -----------------------------------------------------------------------------
-- Cadastros
--
-- Contrapartes ficam liberadas para o assistente de proposito: ele precisa
-- cadastrar um fornecedor novo no meio do lancamento. Plano de contas, contas
-- bancarias e centros de custo exigem contador — mexer neles reescreve o
-- historico dos relatorios.
-- -----------------------------------------------------------------------------
create policy bank_accounts_select on public.bank_accounts
  for select to authenticated using (app.is_member(company_id));
create policy bank_accounts_write on public.bank_accounts
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

create policy categories_select on public.categories
  for select to authenticated using (app.is_member(company_id));
create policy categories_write on public.categories
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

create policy counterparties_select on public.counterparties
  for select to authenticated using (app.is_member(company_id));
create policy counterparties_write on public.counterparties
  for all to authenticated
  using (app.has_role(company_id, 'assistente'))
  with check (app.has_role(company_id, 'assistente'));

create policy cost_centers_select on public.cost_centers
  for select to authenticated using (app.is_member(company_id));
create policy cost_centers_write on public.cost_centers
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

-- -----------------------------------------------------------------------------
-- Lancamentos — com a trava de mes fechado
-- -----------------------------------------------------------------------------
create policy transactions_select on public.transactions
  for select to authenticated
  using (app.is_member(company_id));

create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (
    app.has_role(company_id, 'assistente')
    and not app.is_period_locked(company_id, booking_date)
  );

create policy transactions_update on public.transactions
  for update to authenticated
  using (
    app.has_role(company_id, 'assistente')
    and not app.is_period_locked(company_id, booking_date)
  )
  with check (
    app.has_role(company_id, 'assistente')
    and not app.is_period_locked(company_id, booking_date)
  );

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (
    app.has_role(company_id, 'assistente')
    and not app.is_period_locked(company_id, booking_date)
  );

-- -----------------------------------------------------------------------------
-- Conciliacao
-- -----------------------------------------------------------------------------
create policy statement_imports_select on public.statement_imports
  for select to authenticated using (app.is_member(company_id));
create policy statement_imports_write on public.statement_imports
  for all to authenticated
  using (app.has_role(company_id, 'assistente'))
  with check (app.has_role(company_id, 'assistente'));

create policy statement_lines_select on public.statement_lines
  for select to authenticated using (app.is_member(company_id));
create policy statement_lines_write on public.statement_lines
  for all to authenticated
  using (app.has_role(company_id, 'assistente'))
  with check (app.has_role(company_id, 'assistente'));

create policy matching_rules_select on public.matching_rules
  for select to authenticated using (app.is_member(company_id));
create policy matching_rules_write on public.matching_rules
  for all to authenticated
  using (app.has_role(company_id, 'assistente'))
  with check (app.has_role(company_id, 'assistente'));

-- -----------------------------------------------------------------------------
-- Recorrencias, fechamento e anexos
-- -----------------------------------------------------------------------------
create policy recurrences_select on public.recurrences
  for select to authenticated using (app.is_member(company_id));
create policy recurrences_write on public.recurrences
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

create policy monthly_closings_select on public.monthly_closings
  for select to authenticated using (app.is_member(company_id));
create policy monthly_closings_write on public.monthly_closings
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

create policy monthly_closing_balances_select on public.monthly_closing_balances
  for select to authenticated
  using (exists (
    select 1 from public.monthly_closings c
    where c.id = closing_id and app.is_member(c.company_id)
  ));

create policy monthly_closing_balances_write on public.monthly_closing_balances
  for all to authenticated
  using (exists (
    select 1 from public.monthly_closings c
    where c.id = closing_id and app.has_role(c.company_id, 'contador')
  ))
  with check (exists (
    select 1 from public.monthly_closings c
    where c.id = closing_id and app.has_role(c.company_id, 'contador')
  ));

-- Anexo segue a trava do lancamento a que pertence: comprovante de mes fechado
-- nao pode ser trocado depois do fato.
create policy attachments_select on public.attachments
  for select to authenticated using (app.is_member(company_id));

create policy attachments_write on public.attachments
  for all to authenticated
  using (
    app.has_role(company_id, 'assistente')
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and not app.is_period_locked(t.company_id, t.booking_date)
    )
  )
  with check (
    app.has_role(company_id, 'assistente')
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id
        and not app.is_period_locked(t.company_id, t.booking_date)
    )
  );

-- -----------------------------------------------------------------------------
-- Auditoria: leitura para contador e dono. Ninguem escreve — as linhas so entram
-- pelo trigger, que roda como dono da tabela. Sem policy de escrita, INSERT,
-- UPDATE e DELETE vindos da aplicacao sao simplesmente negados, o que e
-- exatamente o que se espera de uma trilha de auditoria.
-- -----------------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (company_id is not null and app.has_role(company_id, 'contador'));

-- =============================================================================
-- Criacao de empresa.
--
-- Problema do ovo e da galinha: a policy de INSERT em companies exigiria um
-- vinculo que ainda nao existe. SECURITY DEFINER resolve criando empresa e
-- vinculo de dono na mesma transacao — e o unico ponto do sistema que roda com
-- privilegio elevado, por isso e curto e sem parametro que escolha usuario:
-- o dono e sempre auth.uid(), nunca um id vindo do cliente.
-- =============================================================================
create or replace function public.create_company(
  p_name       text,
  p_legal_name text default null,
  p_tax_id     text default null
)
returns public.companies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company public.companies;
begin
  if auth.uid() is null then
    raise exception 'Autenticacao obrigatoria';
  end if;

  insert into public.companies (name, legal_name, tax_id)
  values (p_name, p_legal_name, nullif(regexp_replace(coalesce(p_tax_id, ''), '\D', '', 'g'), ''))
  returning * into v_company;

  insert into public.memberships (company_id, user_id, role)
  values (v_company.id, auth.uid(), 'owner');

  return v_company;
end;
$$;

grant execute on function public.create_company(text, text, text) to authenticated;

-- =============================================================================
-- Grants. O RLS so entra em acao depois do grant; sem ele o usuario levaria
-- "permission denied" antes de qualquer policy ser avaliada.
-- =============================================================================
grant select, insert, update, delete on all tables in schema public to authenticated;

-- A trilha de auditoria e so de leitura para a aplicacao. A ausencia de policy de
-- escrita ja bastaria, mas RLS nega em silencio: um DELETE apagaria zero linhas
-- sem erro nenhum. Revogar o privilegio faz a tentativa falhar alto, e deixa a
-- intencao registrada no nivel de permissao, nao so no de policy. As linhas
-- continuam entrando pelo trigger, que roda como dono da tabela.
revoke insert, update, delete on public.audit_log from authenticated;
grant select on public.v_account_balances            to authenticated;
grant select on public.v_account_daily_movement      to authenticated;
grant select on public.v_monthly_category_summary    to authenticated;
grant usage, select on all sequences in schema public to authenticated;
