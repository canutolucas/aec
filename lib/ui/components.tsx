/**
 * Componentes basicos compartilhados.
 */

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { type Cents, formatBRL } from "@/lib/domain/money";
import { amountClass } from "./format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-[--color-borda] bg-[--color-superficie] ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[--color-borda] px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-[--color-marca] text-white hover:opacity-90",
  secondary: "border border-[--color-borda] bg-[--color-superficie] hover:bg-[--color-fundo]",
  danger: "border border-[--color-saida] text-[--color-saida] hover:bg-red-50",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function LinkButton({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <Link
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[--color-tinta-fraca]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[--color-tinta-fraca]">{hint}</span>}
    </label>
  );
}

const CONTROL =
  "w-full rounded-md border border-[--color-borda] bg-[--color-superficie] px-3 py-2 text-sm outline-none focus:border-[--color-marca] focus:ring-2 focus:ring-[--color-marca-fraca]";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${CONTROL} ${className}`} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${CONTROL} ${className}`} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${CONTROL} ${className}`} />;
}

/** Valor monetario com cor e alinhamento tabular. */
export function Money({ cents, className = "" }: { cents: Cents; className?: string }) {
  return (
    <span className={`numero ${amountClass(cents)} ${className}`}>{formatBRL(cents)}</span>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-[--color-borda] bg-[--color-fundo] text-[--color-tinta]",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  } as const;

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

/**
 * Estado vazio que diz o proximo passo, em vez de so informar que nao ha nada.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[--color-tinta-fraca]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "success" | "info";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-[--color-fundo] text-[--color-tinta-fraca] border-[--color-borda]",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    info: "bg-[--color-marca-fraca] text-[--color-marca] border-[--color-marca-fraca]",
  } as const;

  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}
