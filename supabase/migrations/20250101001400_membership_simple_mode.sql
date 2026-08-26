-- =============================================================================
-- Modo simples: uma segunda experiencia de uso, mais enxuta, para quem so
-- precisa entrar, subir o extrato do banco e ter o mes organizado — sem
-- nenhuma das telas avancadas (Relatorios, Cadastros, Equipe, Conciliacao
-- manual, etc).
--
-- E uma preferencia de NAVEGACAO, nao de permissao: o papel (`role`)
-- continua sendo a unica coisa que a RLS valida. Uma pessoa com
-- role=assistente e simple_mode=true tem exatamente os mesmos privilegios
-- de escrita que qualquer outro assistente — so ve uma interface diferente.
-- Por isso a coluna fica em memberships (o vinculo pessoa+empresa), nao em
-- profiles: a mesma pessoa pode preferir o modo simples numa empresa e o
-- modo avancado em outra.
-- =============================================================================

alter table public.memberships
  add column simple_mode boolean not null default false;
