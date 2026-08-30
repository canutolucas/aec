-- =============================================================================
-- Fecha uma lacuna da trilha de auditoria (20250101000500_recorrencias_anexos.sql
-- ja criou app.write_audit_log() e a ligou em transactions/bank_accounts/
-- monthly_closings/memberships; 20250101001500_faturamento.sql fez o mesmo em
-- invoices/invoice_settlements). Varias tabelas que tambem sao escritas por
-- quem opera a contabilidade nunca ganharam o trigger -- uma categoria
-- renomeada, uma regra de correspondencia desativada, um centro de custo
-- apagado nao deixavam rastro nenhum. Cada linha abaixo e o mesmo padrao ja
-- em producao, sem nada novo: so fecha a lacuna documentada no CLAUDE.md.
-- =============================================================================

create trigger categories_audit
  after insert or update or delete on public.categories
  for each row execute function app.write_audit_log();

create trigger counterparties_audit
  after insert or update or delete on public.counterparties
  for each row execute function app.write_audit_log();

create trigger cost_centers_audit
  after insert or update or delete on public.cost_centers
  for each row execute function app.write_audit_log();

create trigger matching_rules_audit
  after insert or update or delete on public.matching_rules
  for each row execute function app.write_audit_log();

create trigger statement_imports_audit
  after insert or update or delete on public.statement_imports
  for each row execute function app.write_audit_log();

create trigger statement_lines_audit
  after insert or update or delete on public.statement_lines
  for each row execute function app.write_audit_log();

-- As duas tabelas de perfis de contas (20250101001800_account_profiles.sql)
-- nasceram depois da trilha de auditoria existir e ficaram de fora pelo
-- mesmo motivo: ninguem voltou para religar o trigger nelas.
create trigger account_profiles_audit
  after insert or update or delete on public.account_profiles
  for each row execute function app.write_audit_log();

create trigger account_profile_accounts_audit
  after insert or update or delete on public.account_profile_accounts
  for each row execute function app.write_audit_log();
