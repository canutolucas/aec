"use client";

import { type DragEvent, useRef, useState } from "react";

import { cn } from "../lib/cn";

/**
 * Arrastar-e-soltar com clique como alternativa — para o fluxo simples, onde
 * subir o arquivo e a unica acao da tela e precisa ser obvia sem exigir
 * nenhuma instrucao.
 *
 * So recebe o(s) arquivo(s) e avisa via onFiles: quem usa isto decide o que
 * fazer com eles (ler, importar, etc.) — este componente nao sabe nada
 * sobre extrato bancario ou nota fiscal.
 */
export function Dropzone({
  accept,
  disabled = false,
  multiple = false,
  onFiles,
  label = "Arraste o arquivo aqui, ou clique para escolher",
  hint,
}: {
  accept: string;
  disabled?: boolean;
  /** Permite escolher/arrastar mais de um arquivo de uma vez (ex.: um XML por nota). */
  multiple?: boolean;
  onFiles: (files: readonly File[]) => void;
  label?: string;
  hint?: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(multiple ? files : [files[0]!]);
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "border-border flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:border-primary/50 hover:bg-muted/40 cursor-pointer",
        isDragging && "border-primary bg-primary/5",
      )}
    >
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        // Extension-only, deliberadamente: ver o mesmo comentario em
        // conciliacao-client.tsx — misturar um MIME nao-padrao (OFX nao tem
        // um registrado) com extensoes reais degrada o filtro de arquivo
        // inteiro no Safari/iOS.
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          // Limpa o valor: sem isso, escolher o(s) MESMO(S) arquivo(s) de
          // novo depois de um erro nao dispara onChange na segunda vez.
          event.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
