-- =============================================================================
-- Stub minimo do que o Supabase fornece pronto: schema `auth`, a funcao
-- auth.uid() e os papeis do PostgREST.
--
-- Existe para que as migrations e os testes de RLS rodem em um Postgres puro,
-- no CI e na maquina de quem desenvolve, sem depender de Docker. NAO faz parte
-- das migrations da aplicacao — em producao o Supabase ja traz tudo isto.
--
-- auth.uid() e a implementacao real do Supabase: le o `sub` do JWT que o
-- PostgREST publica em `request.jwt.claims`. Nos testes basta setar essa
-- variavel para atuar como um usuario.
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                   uuid primary key default gen_random_uuid(),
  email                text unique,
  raw_user_meta_data   jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
