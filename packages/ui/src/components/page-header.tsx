/**
 * Cabecalho de pagina — antes desta leva, 3 telas copiavam esta mesma
 * estrutura byte a byte (h1 + p) e outras 3 nao tinham cabecalho nenhum.
 * Um so lugar agora, com slot de acao (que nao existia).
 */
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
