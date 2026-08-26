import { renderMark } from "../../_brand/mark";

/**
 * Icone 192x192 do manifest (manifest.ts) — o que o Android usa no
 * "Adicionar a tela inicial". fontScale bem menor que o favicon/apple-icon:
 * o Android pode recortar este icone num circulo ou squircle adaptativo, e
 * a marca precisa caber inteira dentro dessa "zona segura" central mesmo
 * cortada, sem perder nenhuma letra.
 */
export function GET() {
  return renderMark(192, 0.38);
}
