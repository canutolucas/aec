-- =============================================================================
-- Perfis (lentes gerenciais de contas) -- pedido direto da usuaria final: ela
-- quer "subdividir a empresa para entender como esta cada ramo", agrupando um
-- conjunto de contas bancarias sob um nome ("Servicos por fora", "Contabil
-- empresarial") e ver o app filtrado por essa lente -- uma, varias, ou
-- todas de uma vez.
--
-- Isto NAO e uma segunda fronteira de empresa: fechamento de mes, NFS-e e
-- RLS continuam por `companies`. Um perfil e so um filtro de leitura sobre
-- quais bank_account_id entram nas consultas -- por isso account_profiles
-- e account_profile_accounts (N:N: a mesma conta pode estar em mais de uma
-- lente).
--
-- Nome em ingles evita colisao com a tabela `public.profiles` que ja existe
-- (espelho de auth.users, ver 20250101000000_core.sql) -- "AccountProfile"
-- no lado TypeScript, sem ambiguidade com `Profile`.
-- =============================================================================

create table public.account_profiles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, name)
);

-- Para a FK composta de account_profile_accounts poder apontar para ca, no
-- mesmo padrao que bank_accounts/categories/counterparties/cost_centers/
-- invoices ja usam.
alter table public.account_profiles
  add constraint account_profiles_id_company_key unique (id, company_id);

create trigger account_profiles_touch before update on public.account_profiles
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- O vinculo N:N em si. company_id redundante (existe em account_profiles E em
-- bank_accounts) e proposital: e o que permite a FK composta em CADA lado
-- confirmar, dentro do proprio banco, que perfil e conta pertencem a mesma
-- empresa -- sem isso, so a aplicacao garantiria essa regra.
-- -----------------------------------------------------------------------------
create table public.account_profile_accounts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  profile_id      uuid not null,
  bank_account_id uuid not null,
  created_at      timestamptz not null default now(),
  constraint account_profile_accounts_profile_fk
    foreign key (profile_id, company_id)
    references public.account_profiles (id, company_id) on delete cascade,
  constraint account_profile_accounts_bank_account_fk
    foreign key (bank_account_id, company_id)
    references public.bank_accounts (id, company_id) on delete cascade,
  unique (profile_id, bank_account_id)
);

create index account_profile_accounts_profile_idx
  on public.account_profile_accounts (profile_id);
create index account_profile_accounts_bank_account_idx
  on public.account_profile_accounts (bank_account_id);

-- -----------------------------------------------------------------------------
-- RLS: mesmo modelo de bank_accounts -- leitura para qualquer membro,
-- escrita a partir de contador (perfil e organizacao gerencial, papel mais
-- proximo de quem mexe em contas/cadastros do que de quem so lanca).
-- -----------------------------------------------------------------------------
alter table public.account_profiles        enable row level security;
alter table public.account_profile_accounts enable row level security;

create policy account_profiles_select on public.account_profiles
  for select to authenticated
  using (app.is_member(company_id));

create policy account_profiles_write on public.account_profiles
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

create policy account_profile_accounts_select on public.account_profile_accounts
  for select to authenticated
  using (app.is_member(company_id));

create policy account_profile_accounts_write on public.account_profile_accounts
  for all to authenticated
  using (app.has_role(company_id, 'contador'))
  with check (app.has_role(company_id, 'contador'));

-- A migration que faz `grant ... on all tables in schema public to
-- authenticated` (20250101000700_rls.sql) so alcanca as tabelas que ja
-- existiam quando ela rodou -- sem estes GRANTs explicitos aqui, toda policy
-- acima seria irrelevante: o Postgres nega o acesso na checagem de
-- privilegio de tabela, antes mesmo de chegar a avaliar RLS.
grant select, insert, update, delete on public.account_profiles         to authenticated;
grant select, insert, update, delete on public.account_profile_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- Cria o perfil e ja grava o conjunto inicial de contas numa unica
-- transacao -- sem isto, a tela precisaria de duas chamadas separadas
-- (criar perfil, depois vincular contas) e um perfil sem NENHUMA conta
-- poderia ficar visivel entre uma chamada e outra se a segunda falhasse.
-- -----------------------------------------------------------------------------
create or replace function public.create_account_profile(
  p_company_id uuid,
  p_name text,
  p_bank_account_ids uuid[]
)
returns public.account_profiles
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile public.account_profiles;
begin
  if not app.has_role(p_company_id, 'contador') then
    raise exception 'Apenas contador ou responsavel pode criar perfis de contas.';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Informe o nome do perfil.';
  end if;

  if p_bank_account_ids is null or array_length(p_bank_account_ids, 1) is null then
    raise exception 'Escolha ao menos uma conta para o perfil.';
  end if;

  insert into public.account_profiles (company_id, name)
  values (p_company_id, btrim(p_name))
  returning * into v_profile;

  insert into public.account_profile_accounts (company_id, profile_id, bank_account_id)
  select p_company_id, v_profile.id, account_id
  from unnest(p_bank_account_ids) as account_id;

  return v_profile;
end;
$$;

grant execute on function public.create_account_profile(uuid, text, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Substitui de uma vez o conjunto de contas de um perfil ja existente --
-- delete+insert atomicos, para a tela de edicao nunca deixar um perfil com
-- metade das contas antigas e metade das novas se a chamada falhasse no meio
-- de duas escritas separadas.
-- -----------------------------------------------------------------------------
create or replace function public.set_account_profile_accounts(
  p_profile_id uuid,
  p_company_id uuid,
  p_bank_account_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not app.has_role(p_company_id, 'contador') then
    raise exception 'Apenas contador ou responsavel pode editar quais contas entram num perfil.';
  end if;

  if not exists (
    select 1 from public.account_profiles
     where id = p_profile_id and company_id = p_company_id
  ) then
    raise exception 'Perfil nao encontrado nesta empresa.';
  end if;

  if p_bank_account_ids is null or array_length(p_bank_account_ids, 1) is null then
    raise exception 'Escolha ao menos uma conta para o perfil.';
  end if;

  delete from public.account_profile_accounts
   where profile_id = p_profile_id and company_id = p_company_id;

  insert into public.account_profile_accounts (company_id, profile_id, bank_account_id)
  select p_company_id, p_profile_id, account_id
  from unnest(p_bank_account_ids) as account_id;
end;
$$;

grant execute on function public.set_account_profile_accounts(uuid, uuid, uuid[]) to authenticated;
