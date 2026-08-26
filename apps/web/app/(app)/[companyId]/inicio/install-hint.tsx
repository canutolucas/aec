"use client";

/**
 * Convite discreto para adicionar o app a tela inicial do celular — os
 * icones e o manifest ja existem (app/icon.tsx, app/apple-icon.tsx,
 * app/manifest.ts), so faltava avisar que a opcao existe. iOS nao tem um
 * prompt automatico de instalacao (so Android/Chrome tem), entao o caminho
 * comum aos dois e so texto: "Compartilhar" no iOS, o menu do navegador no
 * Android.
 */

import { startTransition, useEffect, useState } from "react";

const DISMISSED_KEY = "aec-install-hint-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari/iOS nao suporta a media query acima — usa a propriedade propria.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISSED_KEY) === "1") return;
    // react-hooks/set-state-in-effect: setState direto no corpo do efeito
    // dispara um render em cascata — o mesmo padrao ja usado em
    // recebimentos-client.tsx, so que aqui nao ha nada assincrono de
    // verdade, so o boundary que a regra exige.
    startTransition(() => setVisible(true));
  }, []);

  if (!visible) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Sem acesso a localStorage (aba privada, navegador restrito) — so
      // nao lembra na proxima visita, sem quebrar nada.
    }
    setVisible(false);
  }

  const instructions = isIOS()
    ? 'Toque em "Compartilhar" (o iconezinho com a seta) e depois em "Adicionar a Tela de Inicio".'
    : 'Abra o menu do navegador (geralmente tres pontinhos) e toque em "Instalar app" ou "Adicionar a tela inicial".';

  return (
    <div className="border-border bg-muted flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <p>
        <span className="font-medium">Dica:</span> da pra adicionar o AEC na tela inicial do
        celular, como um app. {instructions}
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="text-muted-foreground shrink-0 text-xs underline-offset-2 hover:underline"
      >
        Nao mostrar de novo
      </button>
    </div>
  );
}
