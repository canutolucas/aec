-- =============================================================================
-- Nucleo multiempresa: empresas, perfis, vinculos e funcoes de autorizacao.
--
-- Todo dado de negocio carrega company_id e e isolado por RLS. As funcoes de
-- autorizacao vivem no schema `app` e sao SECURITY DEFINER para que as policies
-- possam consulta-las sem cair em recursao de RLS.
-- =============================================================================

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Papeis, do menor para o maior privilegio.
--   cliente_leitura : so le (portal do cliente)
--   assistente      : lanca e concilia, nao fecha mes nem mexe em cadastros
--   contador        : cadastros e fechamento mensal
--   owner           : tudo, inclusive gestao de usuarios
-- -----------------------------------------------------------------------------
create type app.member_role as enum ('cliente_leitura', 'assistente', 'contador', 'owner');

create or replace function app.role_rank(p_role app.member_role)
returns int
language sql
immutable
as $$
  select case p_role
    when 'cliente_leitura' then 1
    when 'assistente'      then 2
    when 'contador'        then 3
    when 'owner'           then 4
  end;
$$;

-- -----------------------------------------------------------------------------
-- Empresas sob controle. O MVP opera uma, o modelo ja suporta a carteira toda.
-- -----------------------------------------------------------------------------
create table public.companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  legal_name   text,
  tax_id       text,                                    -- CNPJ, somente digitos
  timezone     text not null default 'America/Sao_Paulo',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint companies_tax_id_digits check (tax_id is null or tax_id ~ '^[0-9]{14}$')
);

create unique index companies_tax_id_key on public.companies (tax_id) where tax_id is not null;

-- -----------------------------------------------------------------------------
-- Perfil publico espelhando auth.users.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- -----------------------------------------------------------------------------
-- Vinculo usuario x empresa x papel.
-- -----------------------------------------------------------------------------
create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         app.member_role not null default 'assistente',
  created_at   timestamptz not null default now(),
  unique (company_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- -----------------------------------------------------------------------------
-- Funcoes de autorizacao usadas por todas as policies.
--
-- SECURITY DEFINER e obrigatorio: sem isso, a policy de `memberships` chamaria a
-- si mesma ao verificar o vinculo do usuario e o Postgres aborta por recursao.
-- -----------------------------------------------------------------------------
create or replace function app.current_role_in(p_company_id uuid)
returns app.member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.memberships m
  where m.company_id = p_company_id
    and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function app.is_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.current_role_in(p_company_id) is not null;
$$;

-- Verdadeiro quando o usuario tem pelo menos o papel exigido na empresa.
create or replace function app.has_role(p_company_id uuid, p_min_role app.member_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.role_rank(app.current_role_in(p_company_id)) >= app.role_rank(p_min_role);
$$;

grant execute on function
  app.role_rank(app.member_role),
  app.current_role_in(uuid),
  app.is_member(uuid),
  app.has_role(uuid, app.member_role)
to authenticated;

-- -----------------------------------------------------------------------------
-- updated_at automatico.
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();
