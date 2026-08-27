"use client";

import { Button } from "@aec/ui";
import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { friendlyError } from "@/lib/ui/format";

/**
 * Boundary de erro generico por rota — antes desta leva, nao existia um
 * unico `error.tsx` no app inteiro; um erro nao tratado derrubava a arvore
 * de componentes inteira sem nenhuma tela de recuperacao.
 */
export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
      <AlertTriangle className="text-destructive size-8" aria-hidden />
      <div>
        <p className="text-sm font-medium">Algo deu errado nesta tela</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {friendlyError(error.message, "Nao foi possivel carregar esta tela.")}
        </p>
      </div>
      <Button size="sm" onClick={reset}>
        Tentar de novo
      </Button>
    </div>
  );
}
