"use client";

/**
 * Seletor global de perfis (lentes gerenciais de contas) — vive no
 * cabecalho, ao lado do ThemeToggle, e vale para toda tela que respeita
 * `?perfil=` (ver apps/web/lib/ui/account-profiles.ts). So aparece quando a
 * empresa ja tem pelo menos um perfil cadastrado (ver Contas > Perfis) —
 * antes disso seria um controle vazio, sem nada pra escolher.
 */

import type { AccountProfileWithAccounts } from "@aec/db";
import { Checkbox, cn, Popover, PopoverContent, PopoverTrigger } from "@aec/ui";
import { Layers } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import {
  PERFIL_PARAM,
  resolvePerfilSelecao,
  serializePerfilSelecao,
} from "@/lib/ui/account-profiles";

export function PerfilSelector({ perfis }: { perfis: readonly AccountProfileWithAccounts[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (perfis.length === 0) return null;

  const { perfilIds } = resolvePerfilSelecao(searchParams.get(PERFIL_PARAM) ?? undefined, perfis);
  const todosSelecionados = perfilIds.length === 0;

  function aplicar(novosIds: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    const serializado = serializePerfilSelecao(novosIds);
    if (serializado) params.set(PERFIL_PARAM, serializado);
    else params.delete(PERFIL_PARAM);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}` as never);
    });
  }

  function alternar(id: string) {
    aplicar(
      perfilIds.includes(id) ? perfilIds.filter((atual) => atual !== id) : [...perfilIds, id],
    );
  }

  const rotulo = todosSelecionados
    ? "Todos os perfis"
    : perfilIds.length === 1
      ? (perfis.find((perfil) => perfil.id === perfilIds[0])?.name ?? "1 perfil")
      : `${perfilIds.length} perfis`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          className="border-border hover:bg-muted text-foreground flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
        >
          <Layers className="size-3.5 shrink-0" aria-hidden />
          <span className="max-w-32 truncate">{rotulo}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <label
          className={cn(
            "hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
            todosSelecionados && "font-medium",
          )}
        >
          <Checkbox checked={todosSelecionados} onCheckedChange={() => aplicar([])} />
          Todos os perfis
        </label>
        <div className="border-border my-1.5 border-t" />
        {perfis.map((perfil) => (
          <label
            key={perfil.id}
            className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          >
            <Checkbox
              checked={perfilIds.includes(perfil.id)}
              onCheckedChange={() => alternar(perfil.id)}
            />
            <span className="truncate">{perfil.name}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
