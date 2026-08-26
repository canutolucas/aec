-- =============================================================================
-- Adicionar integrante a uma empresa.
--
-- Faltava por completo: memberships so ganhava uma linha via
-- public.create_company (o dono, na hora de criar a empresa) — nao havia
-- nenhum jeito de convidar uma segunda pessoa.
--
-- O motivo de precisar de uma funcao aqui, e nao um INSERT direto do
-- cliente: `profiles_select_self` (20250101000700_rls.sql) so deixa
-- enxergar o proprio perfil ou o de quem ja compartilha uma empresa com
-- voce — ou seja, antes do vinculo existir, o dono nao consegue nem
-- encontrar o id da pessoa pelo e-mail para montar o INSERT. E o mesmo
-- ovo-e-galinha que create_company resolve para o proprio dono; aqui e
-- para o proximo integrante. SECURITY DEFINER e o que permite a busca por
-- e-mail atravessar essa policy — por isso a checagem de papel do
-- CHAMADOR vem antes de qualquer outra coisa na funcao, nunca depois.
-- =============================================================================

create or replace function public.add_member(
  p_company_id uuid,
  p_email      text,
  p_role       app.member_role default 'assistente'
)
returns public.memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_membership public.memberships;
begin
  if not app.has_role(p_company_id, 'owner') then
    raise exception 'Apenas o responsavel pela empresa pode adicionar integrantes.';
  end if;

  select id into v_profile_id
    from public.profiles
   where email = lower(btrim(p_email));

  if v_profile_id is null then
    raise exception 'Nao existe conta com este e-mail. A pessoa precisa criar a conta primeiro.';
  end if;

  insert into public.memberships (company_id, user_id, role)
  values (p_company_id, v_profile_id, p_role)
  returning * into v_membership;

  return v_membership;
exception
  when unique_violation then
    raise exception 'Esta pessoa ja e integrante desta empresa.';
end;
$$;

grant execute on function public.add_member(uuid, text, app.member_role) to authenticated;

-- -----------------------------------------------------------------------------
-- Remover ou rebaixar o ultimo owner deixaria a empresa sem ninguem que
-- possa administra-la — sem nem um caminho de volta pela propria aplicacao.
-- memberships_write ja restringe quem pode mexer em memberships a quem tem
-- papel de owner, mas nao impede um owner sozinho de se remover ou se
-- rebaixar por engano. A trava e uma invariante da tabela, nao de uma
-- policy: vale tanto para o DELETE feito direto pelo cliente (RLS ja
-- autoriza) quanto para qualquer futuro caminho de escrita.
-- -----------------------------------------------------------------------------
create or replace function app.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.role = 'owner'
     and not (tg_op = 'UPDATE' and new.role = 'owner')
     and not exists (
       select 1 from public.memberships
        where company_id = old.company_id
          and role = 'owner'
          and id <> old.id
     )
  then
    raise exception 'A empresa precisa manter ao menos um responsavel (owner).';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger memberships_guard_last_owner
  before delete or update of role on public.memberships
  for each row execute function app.guard_last_owner();
