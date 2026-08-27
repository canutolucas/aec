"use client";

/**
 * Notificacao temporaria fora do fluxo do documento — substitui o padrao
 * `{feedback && <Alert>...}` no topo de cada tela, que em telas longas
 * (conciliacao, cadastros) fica fora da area visivel depois de uma acao no
 * meio ou no fim da lista.
 *
 * Contexto React simples em vez de uma lib externa: o app nao tem nenhuma
 * outra dependencia de notificacao, e a necessidade real e so "mostrar uma
 * mensagem por alguns segundos, empilhavel".
 */

import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "../lib/cn";

export type ToastTone = "success" | "error" | "warn" | "info";

interface ToastItem {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
}

interface ToastContextValue {
  toast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-inflow/30 text-inflow bg-card",
  error: "border-destructive/30 text-destructive bg-card",
  warn: "border-warning/30 text-warning bg-card",
  info: "border-border text-foreground bg-card",
};

const DURATION_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((text: string, tone: ToastTone = "success") => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }, DURATION_MS);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
        aria-live="polite"
      >
        {items.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <div
              key={item.id}
              role="status"
              className={cn(
                "flex w-full max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg",
                TONE_CLASSES[item.tone],
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="flex-1">{item.text}</p>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="size-3.5" aria-hidden />
                <span className="sr-only">Fechar</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Fora do `ToastProvider` (ex.: testes isolados), vira um no-op em vez de crashar. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  return context ?? { toast: () => {} };
}
