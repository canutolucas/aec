-- =============================================================================
-- `categories_company_id_parent_id_name_key` (the table's own unique
-- constraint on `company_id, parent_id, name`) never fires for a top-level
-- category: Postgres treats every NULL as distinct from every other NULL in
-- a unique constraint, and `parent_id` is NULL for every category with no
-- parent — which, before this migration, was all of them (nothing in the
-- app creates a child category yet). Two "Honorarios" categories in the
-- same company could coexist with no error, silently.
--
-- The fix mirrors `counterparties_company_tax_id_key` a few migrations up:
-- a partial unique index that only applies where the nullable column
-- actually IS null, which is exactly the case the table-level constraint
-- misses.
-- =============================================================================

create unique index categories_company_top_level_name_key
  on public.categories (company_id, name)
  where parent_id is null;
