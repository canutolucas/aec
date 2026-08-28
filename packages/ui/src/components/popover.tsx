"use client";

/**
 * Painel flutuante ancorado a um gatilho (o seletor de perfis no cabecalho e
 * o primeiro uso). Sobre Radix Popover — mesma familia de Dialog/Tooltip,
 * so que aberto por clique e fechado ao clicar fora, sem tomar a tela toda.
 */

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-card border-border z-50 min-w-56 rounded-lg border p-2 shadow-lg",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
