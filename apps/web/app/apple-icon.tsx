import { renderMark } from "./_brand/mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Icone de "Adicionar a Tela de Inicio" no iOS. O proprio iOS aplica seus
 * cantos arredondados por cima — nunca recorta em circulo — entao a marca
 * pode ocupar mais espaco do que nos icones do Android (ver icons/*).
 */
export default function AppleIcon() {
  return renderMark(180, 0.5);
}
