/**
 * Unwraps a Supabase response, throwing on error.
 *
 * TanStack Query's `queryFn` treats a thrown error as the query's error
 * state; a `{ data, error }` pair returned normally would just look like a
 * successful, empty result. Throwing is what makes a failed request surface
 * as `isError` instead of a silently empty list.
 */
export function unwrap<T>({
  data,
  error,
}: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (error) throw new Error(error.message);
  return data as T;
}
