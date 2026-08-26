/**
 * Type alias for the Supabase client, parametrized with the generated
 * `Database` schema.
 *
 * `packages/db` is imported by both the web app (a Server/browser client
 * from `@supabase/ssr`) and the mobile app (a plain `createClient` from
 * `@supabase/supabase-js`, backed by expo-secure-store). Both satisfy this
 * type, which is all the query functions below need — they never construct
 * a client themselves, only receive one, so this package stays free of
 * `next/headers` and any other framework-specific import.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type DbClient = SupabaseClient<Database>;
