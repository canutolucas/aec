/**
 * Renderiza o icone do app — a mesma marca "aec" do Logo em
 * packages/ui/src/components/logo.tsx (Archivo Black, cor primaria, sobre o
 * fundo do app), so que como um quadrado autonomo em vez de texto inline —
 * para o favicon da aba, o icone de "Adicionar a tela de inicio" do iOS, e
 * os icones do manifest do Android.
 *
 * `_brand` (com underscore): pasta privada do App Router, nunca vira rota —
 * so este arquivo e o .ttf ao lado, consumidos pelos arquivos de icone.
 *
 * As mesmas cores do tema (packages/ui/src/styles/theme.css), copiadas aqui
 * como literais: satori (o motor por tras de ImageResponse) renderiza fora
 * da arvore de CSS/Tailwind do app, sem acesso as custom properties do
 * tema — nao ha var(--primary) para ler aqui.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ImageResponse } from "next/og";

const BACKGROUND = "#f1f0ec"; // --background (tema claro): o mesmo fundo da tela de login.
const PRIMARY = "#01416d"; // --primary (tema claro): o mesmo azul do Logo (text-primary).

let fontCache: Buffer | null = null;

/**
 * Carrega o .ttf uma vez por processo. ImageResponse (satori) so aceita
 * TrueType/OpenType — o woff2 que o Google Fonts serve por padrao para
 * navegadores modernos nao e reconhecido; o .ttf salvo aqui veio da mesma
 * fonte (Archivo Black, subset latin, peso 900), so num formato que o
 * renderizador entende.
 */
function loadFont(): Buffer {
  fontCache ??= readFileSync(join(process.cwd(), "app/_brand/archivo-black-latin.ttf"));
  return fontCache;
}

/**
 * @param size Lado do quadrado, em pixels.
 * @param fontScale Fracao de `size` ocupada pela altura da fonte. Menor para
 *   os icones que o Android pode recortar num circulo/squircle adaptativo
 *   (o texto precisa caber dentro da "zona segura" central mesmo cortado);
 *   maior para favicon/apple-touch-icon, que nunca sao recortados assim.
 */
export function renderMark(size: number, fontScale: number) {
  const fontSize = size * fontScale;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BACKGROUND,
      }}
    >
      <span
        style={{
          fontFamily: "Archivo",
          fontWeight: 900,
          fontSize,
          color: PRIMARY,
          letterSpacing: -fontSize * 0.025,
        }}
      >
        aec
      </span>
    </div>,
    {
      width: size,
      height: size,
      fonts: [{ name: "Archivo", data: loadFont(), weight: 900, style: "normal" }],
    },
  );
}
