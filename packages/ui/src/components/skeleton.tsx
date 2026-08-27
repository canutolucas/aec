/** Placeholder de carregamento — antes desta leva, nenhuma tela tinha um. */
import { cn } from "../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded-md", className)} />;
}
