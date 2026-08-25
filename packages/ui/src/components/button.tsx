import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

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
        sm: "px-2.5 py-1.5 text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export interface LinkButtonProps
  extends ComponentProps<typeof Link>, VariantProps<typeof buttonVariants> {}

export function LinkButton({ className, variant = "secondary", size, ...props }: LinkButtonProps) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
