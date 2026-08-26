-- -----------------------------------------------------------------------------
-- Corrige usuarios criados antes do trigger on_auth_user_created.
--
-- memberships.user_id aponta para public.profiles, nao diretamente para
-- auth.users. Sem este backfill, uma conta antiga consegue autenticar, mas o
-- primeiro cadastro de empresa falha ao criar o vinculo da empresa.
-- -----------------------------------------------------------------------------

insert into public.profiles (id, full_name, email)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', users.email),
  users.email
from auth.users as users
on conflict (id) do update
set
  email = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name);
