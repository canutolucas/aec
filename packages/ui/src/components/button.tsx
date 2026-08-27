import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        secondary: "border border-border bg-card text-foreground hover:bg-muted",
        accent: "bg-accent text-accent-foreground hover:opacity-90",
        danger: "border border-destructive text-destructive hover:bg-destructive/10",
        ghost: "hover:bg-muted",
      },
      size: {
        default: "px-3 py-2",
        // ~44px de altura no celular (alvo de toque mínimo recomendado),
        // volta à densidade original a partir do breakpoint `sm:` — mesmo
        // padrão do CONTROL em form-fields.tsx.
        sm: "px-3 py-3 text-sm sm:px-2.5 sm:py-1.5 sm:text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /**
   * Mostra um spinner e desabilita o botao. Antes desta leva, toda tela do
   * app comunicava "carregando" so trocando o texto do botao na mao
   * ("Gravando...", "Importando..."); isto padroniza sem tirar a
   * possibilidade de continuar trocando o texto tambem.
   */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export interface LinkButtonProps
  extends ComponentProps<typeof Link>, VariantProps<typeof buttonVariants> {}

export function LinkButton({ className, variant = "secondary", size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
