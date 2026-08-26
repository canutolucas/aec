import { renderMark } from "./_brand/mark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Favicon da aba do navegador. */
export default function Icon() {
  return renderMark(32, 0.55);
}
