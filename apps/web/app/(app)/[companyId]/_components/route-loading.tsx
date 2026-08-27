import { Skeleton } from "@aec/ui";

/**
 * Esqueleto generico de carregamento — antes desta leva, nao existia um
 * unico `loading.tsx` no app inteiro; toda navegacao era uma tela em branco
 * enquanto o server component resolvia suas queries.
 */
export function RouteLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
