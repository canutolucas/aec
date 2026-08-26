import { cn } from "../lib/cn";

/**
 * Wordmark: "aec", set in the same sans as the rest of the app (Archivo,
 * loaded as a variable font — no separate weight to import for this) at its
 * heaviest weight, so it reads as a mark rather than as body text that
 * happens to say "aec".
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("text-primary font-sans font-black tracking-tight", className)}>aec</span>
  );
}
