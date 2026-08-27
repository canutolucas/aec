"use client";

/**
 * Alterna claro/escuro. Precisa ser client (le o tema atual via next-themes)
 * e so renderiza depois de montar — o tema real so e conhecido no navegador
 * (pode vir do SO), entao renderizar antes disso citaria um tema errado por
 * uma fracao de segundo.
 */
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className={className} style={{ width: 28, height: 28 }} />;

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={className ?? "text-muted-foreground hover:text-foreground p-1"}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
    >
      {isDark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
