-- =============================================================================
-- Endurece settle_transaction: dois buracos vivos encontrados na varredura
-- desta leva (major update "dia a dia" — editar lancamento, baixa com data e
-- valor reais, tela /previstos).
--
-- A1 — a funcao terminava com `update ... returning * into v_row` sem
-- `if not found`. Quando a policy RLS recusa o UPDATE (ex.: mes fechado —
-- transactions_update usa `using` sobre a data ANTIGA do lancamento), o
-- UPDATE simplesmente afeta zero linhas, sem levantar erro: v_row vira uma
-- linha com todo campo nulo, e a funcao "retorna com sucesso" sem ter
-- mudado nada. `apps/web/lib/db/transactions.ts` (darBaixa) ja conferia
-- `data?.id` por causa disso, mas a funcao SQL e a autoridade real — o
-- proprio banco deve recusar com mensagem clara, nao devolver um nulo
-- silencioso que qualquer chamador (hoje so o app, amanha talvez outro)
-- pode deixar passar batido.
--
-- R11 — a funcao nunca validou o SINAL de p_amount. Um valor positivo
-- informado para a baixa de um previsto de SAIDA (ou negativo para um de
-- ENTRADA) vira o lancamento do avesso — despesa vira receita — e inverte o
-- resultado do mes inteiro, sem aviso nenhum. O app ja deriva o sinal do
-- lado do servidor a partir do previsto original e nunca confia no que a
-- pessoa digitou (`darBaixa`), mas isso e uma trava de aplicacao: nada no
-- banco impede uma chamada direta a RPC com o sinal errado. Valida aqui
-- tambem, que e quem manda de verdade.
--
-- Nao muda a assinatura da funcao — nao precisa regenerar database.types.ts
-- nem tocar em nenhum call site.
-- =============================================================================
create or replace function public.settle_transaction(
  p_transaction_id uuid,
  p_booking_date   date default null,
  p_amount         numeric default null
)
returns public.transactions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row public.transactions;
begin
  select * into v_row from public.transactions where id = p_transaction_id;

  if not found then
    raise exception 'Lancamento nao encontrado';
  end if;

  if v_row.status <> 'previsto' then
    raise exception 'Somente lancamentos previstos podem receber baixa';
  end if;

  if p_amount is not null and sign(p_amount) <> sign(v_row.amount) then
    raise exception
      'O valor da baixa precisa manter o mesmo sentido do previsto — "%" e um lancamento de %',
      v_row.description, case when v_row.amount > 0 then 'entrada' else 'saida' end;
  end if;

  update public.transactions
     set status       = 'realizado',
         booking_date = coalesce(p_booking_date, v_row.booking_date),
         amount       = coalesce(p_amount, v_row.amount)
   where id = p_transaction_id
   returning * into v_row;

  if not found then
    raise exception
      'Nao foi possivel dar baixa: confira se o mes de destino esta aberto e se seu perfil permite lancar.';
  end if;

  return v_row;
end;
$$;
