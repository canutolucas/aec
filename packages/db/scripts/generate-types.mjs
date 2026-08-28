#!/usr/bin/env node
/**
 * Generates packages/db/src/database.types.ts by introspecting a live
 * Postgres schema, in the same shape Supabase's own `gen types typescript`
 * produces (Database.public.Tables/Views/Functions/Enums).
 *
 * Written by hand instead of running the Supabase CLI because that command
 * needs Docker to introspect a `--db-url`, and this project's CI and local
 * dev already have a disposable Postgres one `pg_ctl` away (see
 * packages/db/scripts/dev-db.sh) — no container required. The mapping
 * rules mirror the CLI's own choices closely enough that a future
 * migration to the real CLI, if Docker ever becomes available, would
 * produce compatible output.
 *
 * Usage:
 *   node packages/db/scripts/generate-types.mjs postgresql://user@host:port/db
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const connectionString = process.argv[2];
if (!connectionString) {
  console.error("Usage: generate-types.mjs <postgres-connection-string>");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

const { rows: enumRows } = await client.query(`
  select t.typname as name, e.enumlabel as label
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  order by t.typname, e.enumsortorder
`);

const enums = new Map();
for (const row of enumRows) {
  const labels = enums.get(row.name) ?? [];
  labels.push(row.label);
  enums.set(row.name, labels);
}

/** Maps a Postgres type to the TypeScript type Supabase's own codegen uses. */
function tsType(udtName, isArray) {
  const base = (() => {
    if (enums.has(udtName)) {
      return enums
        .get(udtName)
        .map((label) => JSON.stringify(label))
        .join(" | ");
    }
    switch (udtName) {
      case "uuid":
      case "text":
      case "varchar":
      case "bpchar":
      case "date":
      case "timestamptz":
      case "timestamp":
      case "time":
        return "string";
      // numeric arrives over PostgREST as a string, to avoid float rounding
      // on money — the same reason packages/domain never lets Cents touch a
      // float. int4/int8/float8 come back as JS numbers.
      case "numeric":
        return "string";
      case "int2":
      case "int4":
      case "int8":
      case "float4":
      case "float8":
        return "number";
      case "bool":
        return "boolean";
      case "jsonb":
      case "json":
        return "Json";
      default:
        return "string";
    }
  })();
  // An enum's `base` is a `"a" | "b" | "c"` union — appended directly with
  // no parens, `${base}[]` parses in TS as `"a" | "b" | ("c"[])`, an array
  // type on the last member only, not an array of the union. Every other
  // branch above returns a single identifier, where `X[]` is unambiguous.
  if (!isArray) return base;
  return base.includes(" | ") ? `(${base})[]` : `${base}[]`;
}

async function columnsOf(tableName) {
  const { rows } = await client.query(
    `
    select
      column_name, is_nullable, column_default, is_generated, is_identity,
      data_type, udt_name
    from information_schema.columns
    where table_schema = 'public' and table_name = $1
    order by ordinal_position
    `,
    [tableName],
  );
  return rows.map((row) => ({
    name: row.column_name,
    nullable: row.is_nullable === "YES",
    // `generated always as identity` (audit_log.id) reports its default via
    // is_identity, not column_default — information_schema keeps the two
    // separate even though both mean "the database fills this in".
    hasDefault:
      row.column_default !== null || row.is_generated === "ALWAYS" || row.is_identity === "YES",
    generated: row.is_generated === "ALWAYS",
    tsType: tsType(row.udt_name.replace(/^_/, ""), row.data_type === "ARRAY"),
  }));
}

function renderRow(columns) {
  return columns
    .map((c) => `      ${c.name}: ${c.tsType}${c.nullable ? " | null" : ""};`)
    .join("\n");
}

function renderInsert(columns) {
  return columns
    .map((c) => {
      if (c.generated) return null;
      const optional = c.nullable || c.hasDefault;
      return `      ${c.name}${optional ? "?" : ""}: ${c.tsType}${c.nullable ? " | null" : ""};`;
    })
    .filter(Boolean)
    .join("\n");
}

function renderUpdate(columns) {
  return columns
    .map((c) => {
      if (c.generated) return null;
      return `      ${c.name}?: ${c.tsType}${c.nullable ? " | null" : ""};`;
    })
    .filter(Boolean)
    .join("\n");
}

const { rows: tableRows } = await client.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name
`);
const { rows: viewRows } = await client.query(`
  select table_name from information_schema.views
  where table_schema = 'public'
  order by table_name
`);

// Every foreign key in the public schema, with its referencing/referenced
// columns in matching order — needed so supabase-js can type an embedded
// select (`.select("*, profiles(...)")`) instead of resolving it to
// `SelectQueryError` at the type level. Built from pg_constraint's own
// `conkey`/`confkey` (parallel arrays of column attnums), not
// information_schema's join views: those don't expose a reliable way to
// pair up referencing and referenced columns in order for a composite key
// (this schema has several, e.g. categories' own company-scoped FKs),
// whereas conkey/confkey are already positionally paired by Postgres itself.
const { rows: fkRows } = await client.query(`
  select
    con.conname as constraint_name,
    con.conrelid as conrelid,
    con.conkey as conkey,
    rel.relname as table_name,
    -- Cast away from \`name\` (Postgres's internal identifier type): node-postgres
    -- has no default parser registered for \`_name\` (array of name), the way it
    -- does for _text/_varchar, and silently hands back the raw wire format
    -- instead of a JS array.
    array_agg(att.attname::text order by u.ord) as columns,
    frel.relname as referenced_table,
    array_agg(fatt.attname::text order by u.ord) as referenced_columns
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_class frel on frel.oid = con.confrelid
  join lateral unnest(con.conkey, con.confkey) with ordinality as u(attnum, fattnum, ord) on true
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum
  join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = u.fattnum
  where con.contype = 'f' and nsp.nspname = 'public'
  group by con.conname, con.conrelid, con.conkey, rel.relname, frel.relname
  order by rel.relname, con.conname
`);

// A foreign key is "one to one" (isOneToOne) when its own referencing
// columns are also covered by a unique or primary key constraint on that
// same table — i.e. at most one row per referenced row, not many.
const { rows: uniqueRows } = await client.query(`
  select conrelid, conkey from pg_constraint where contype in ('u', 'p')
`);
const uniqueKeySets = new Set(uniqueRows.map((r) => `${r.conrelid}:${JSON.stringify(r.conkey)}`));

const relationshipsByTable = new Map();
for (const row of fkRows) {
  const list = relationshipsByTable.get(row.table_name) ?? [];
  list.push({
    foreignKeyName: row.constraint_name,
    columns: row.columns,
    isOneToOne: uniqueKeySets.has(`${row.conrelid}:${JSON.stringify(row.conkey)}`),
    referencedRelation: row.referenced_table,
    referencedColumns: row.referenced_columns,
  });
  relationshipsByTable.set(row.table_name, list);
}

function renderRelationships(tableName) {
  const list = relationshipsByTable.get(tableName) ?? [];
  if (list.length === 0) return "[];";
  const items = list
    .map(
      (r) => `        {
          foreignKeyName: ${JSON.stringify(r.foreignKeyName)};
          columns: [${r.columns.map((c) => JSON.stringify(c)).join(", ")}];
          isOneToOne: ${r.isOneToOne};
          referencedRelation: ${JSON.stringify(r.referencedRelation)};
          referencedColumns: [${r.referencedColumns.map((c) => JSON.stringify(c)).join(", ")}];
        }`,
    )
    .join(",\n");
  return `[\n${items},\n      ];`;
}

const tableBlocks = [];
for (const { table_name: name } of tableRows) {
  const columns = await columnsOf(name);
  tableBlocks.push(`    ${name}: {
      Row: {
${renderRow(columns)}
      };
      Insert: {
${renderInsert(columns)}
      };
      Update: {
${renderUpdate(columns)}
      };
      Relationships: ${renderRelationships(name)}
    };`);
}

const viewBlocks = [];
for (const { table_name: name } of viewRows) {
  const columns = await columnsOf(name);
  viewBlocks.push(`    ${name}: {
      Row: {
${renderRow(columns)}
      };
      Relationships: [];
    };`);
}

/**
 * Splits `pg_get_function_arguments()`'s output into individual arguments.
 * Safe with a plain comma split here because none of this project's public
 * RPCs take a composite or anything else whose textual form could itself
 * contain a comma — every argument is `name type[ DEFAULT ...]`. An array
 * type (`uuid[]`) is fine: the `[]` suffix has no comma in it either, it's
 * just stripped back off below before mapping to a TS type.
 */
function parseArgs(argsText) {
  if (!argsText.trim()) return [];
  return argsText.split(/,\s*/).map((raw) => {
    const hasDefault = /\bDEFAULT\b/i.test(raw);
    const withoutDefault = raw.replace(/\s+DEFAULT\s+.*$/i, "").trim();
    const [name, type] = withoutDefault.split(/\s+/);
    return { name, type, optional: hasDefault };
  });
}

const tableNames = new Set(tableRows.map((r) => r.table_name));

/** Maps a scalar or `SETOF <table>` return type to its TS shape. */
function returnType(ret) {
  if (ret === "void") return "undefined";
  const setOf = /^SETOF\s+(\w+)$/.exec(ret);
  if (setOf && tableNames.has(setOf[1])) {
    return `Database['public']['Tables']['${setOf[1]}']['Row'][]`;
  }
  if (tableNames.has(ret)) return `Database['public']['Tables']['${ret}']['Row']`;
  return tsType(ret, false);
}

// Extension functions (pgcrypto's crypt/digest/armor/... also live in the
// `public` schema by default) are excluded via pg_depend — they aren't part
// of this project's own RPC surface and Supabase's own generator skips them
// the same way.
const { rows: functionRows } = await client.query(`
  select p.proname as name,
         pg_get_function_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as ret
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  order by p.proname
`);

const functionBlocks = functionRows.map(({ name, args, ret }) => {
  const parsedArgs = parseArgs(args);
  const argsBlock = parsedArgs
    .map((a) => {
      // pg_get_function_arguments() renders an array parameter as `uuid[]`,
      // `text[]` etc — a suffix tsType() doesn't strip on its own (its
      // isArray flag is meant to be computed by the caller, same as
      // columnsOf() already does for table columns). Without stripping it
      // here, an array arg silently mapped to "string" — every value
      // rejected at the type level, first hit by create_account_profile's
      // p_bank_account_ids (this project's first RPC to take an array).
      const isArrayType = a.type.endsWith("[]");
      const baseType = isArrayType ? a.type.slice(0, -2) : a.type;
      return `${a.name}${a.optional ? "?" : ""}: ${tsType(baseType, isArrayType)}${a.optional ? " | null" : ""}`;
    })
    .join("; ");
  return `    ${name}: {
      Args: { ${argsBlock} };
      Returns: ${returnType(ret)};
    };`;
});

const enumBlocks = [...enums.entries()].map(
  ([name, labels]) => `    ${name}: ${labels.map((l) => JSON.stringify(l)).join(" | ")};`,
);

const output = `/**
 * Generated by packages/db/scripts/generate-types.mjs — do not edit by hand.
 *
 * Regenerate after any schema migration:
 *   su postgres -c 'bash packages/db/scripts/dev-db.sh'   # prints a connection string
 *   node packages/db/scripts/generate-types.mjs "$DATABASE_URL"
 *   pnpm exec prettier --write packages/db/src/database.types.ts
 *
 * (or point it at any Postgres that already has every migration applied —
 * a local \`supabase start\` works too. dev-db.sh exists instead of
 * tests/sql/run.sh here because that script tears its instance down the
 * moment it finishes, which is right for a test run and useless for this.)
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
${tableBlocks.join("\n")}
    };
    Views: {
${viewBlocks.join("\n")}
    };
    Functions: {
${functionBlocks.join("\n")}
    };
    Enums: {
${enumBlocks.join("\n")}
    };
  };
}
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "database.types.ts");
writeFileSync(outPath, output);
console.log(`Wrote ${outPath}`);

await client.end();
