"use client";

/**
 * Modal acessivel (foco preso, fecha com Esc, fecha clicando fora) sobre
 * Radix Dialog. Substitui o `confirm()` cru do navegador — ate esta leva, a
 * unica confirmacao destrutiva do app inteiro era `window.confirm()` em
 * lancamentos/acoes-lancamento.tsx.
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { cn } from "../lib/cn";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          "bg-card border-border fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border p-6 shadow-lg",
          // No celular, ocupa a largura quase inteira e nao trava se o
          // conteudo for mais alto que a tela.
          "max-h-[90vh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="text-muted-foreground hover:bg-muted absolute top-4 right-4 rounded-md p-1.5">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="grid gap-1.5 pr-6">
      <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
      {description && (
        <DialogPrimitive.Description className="text-muted-foreground text-sm">
          {description}
        </DialogPrimitive.Description>
      )}
    </div>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

/**
 * Confirmacao destrutiva pronta — o substituto direto do `confirm()`
 * nativo. `open`/`onOpenChange` controlados por quem chama (nao ha um
 * `confirm()` sincrono equivalente com um modal de verdade).
 *
 * `onConfirm` pode devolver uma Promise (o caso comum: uma Server Action) —
 * o dialogo so fecha depois dela resolver, em vez de fechar na hora e deixar
 * a acao terminando por baixo sem ninguem ver o resultado.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  tone = "default",
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => unknown | Promise<unknown>;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title={title} description={description} />
        <DialogFooter>
          <DialogPrimitive.Close asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogPrimitive.Close>
          <Button
            type="button"
            disabled={disabled}
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setPending(false);
              }
            }}
            className={cn(
              tone === "danger" && "bg-destructive text-destructive-foreground hover:opacity-90",
            )}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
