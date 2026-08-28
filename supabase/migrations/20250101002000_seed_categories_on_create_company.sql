-- =============================================================================
-- Fase 4 da reforma de UI/UX: empresa nova nasce com um plano de contas
-- minimo, em vez de vazia.
--
-- Ate esta migration, create_company() so criava a empresa e o membership
-- do owner -- nenhuma categoria. No modo simples, o Select de categoria
-- ficava vazio e o botao de lancar ficava permanentemente desabilitado, sem
-- nenhuma tela explicando por que (e /cadastros, onde a categoria seria
-- criada, e inalcancavel em modo simples). O primeiro uso do sistema, pra
-- quem esta nesse modo, era um beco sem saida.
--
-- O conjunto abaixo e deliberadamente pequeno e generico (o tipo de plano
-- de contas que qualquer pequena empresa reconhece de cara) -- e um ponto
-- de partida pra editar/expandir em Cadastros, nao uma tentativa de acertar
-- o plano de contas definitivo de ninguem.
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

  insert into public.categories (company_id, name, kind) values
    (v_company.id, 'Vendas e serviços', 'entrada'),
    (v_company.id, 'Outras receitas', 'entrada'),
    (v_company.id, 'Fornecedores', 'saida'),
    (v_company.id, 'Salários e encargos', 'saida'),
    (v_company.id, 'Impostos e taxas', 'saida'),
    (v_company.id, 'Aluguel', 'saida'),
    (v_company.id, 'Despesas administrativas', 'saida'),
    (v_company.id, 'Tarifas bancárias', 'saida'),
    (v_company.id, 'Outras despesas', 'saida');

  return v_company;
end;
$$;

grant execute on function public.create_company(text, text, text) to authenticated;
