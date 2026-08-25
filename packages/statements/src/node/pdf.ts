/**
 * Positioned text extraction from a PDF.
 *
 * A PDF has no lines or columns: it has loose chunks of text, each with its
 * own coordinate, in arbitrary order. Rebuilding the table means grouping the
 * chunks that share the same `y` (the line) and ordering them by `x` (the
 * columns). That's all this function does — interpreting the content is the
 * job of each bank's reader.
 *
 * The separation exists so the layout reader is a PURE function over text
 * lines, testable without any binary PDF. That matters here: a real
 * statement carries real financial data, which can't become a repository
 * fixture.
 */

import { ImportError } from "../universal/types";

export interface PdfCell {
  readonly x: number;
  /** Width in points. Used to know where the chunk ends. */
  readonly width: number;
  readonly text: string;
}

export interface PdfLine {
  readonly page: number;
  readonly y: number;
  /** X coordinate of the first chunk. Distinguishes a heading from an indented line. */
  readonly indent: number;
  /** The chunks joined in column order. */
  readonly text: string;
  readonly cells: readonly PdfCell[];
}

/**
 * Vertical tolerance for treating two chunks as being on the same line.
 * Superscript and accented characters shift `y` by fractions of a point;
 * half a point groups that without merging neighboring lines, which in a
 * statement are 20 points or more apart.
 */
const Y_TOLERANCE = 0.5;

/**
 * Horizontal distance beyond which two chunks are different columns.
 *
 * Below that, they're one piece of text the PDF split in the middle — the
 * case of a truncated name's ellipsis, which comes as a separate chunk and
 * needs to be glued back: "Le Va Tout Do Brasil L" + "…". Above it, it's
 * another column, and joining with no space would produce "Pagamento
 * recebidoLe Va Tout".
 */
const COLUMN_THRESHOLD = 2;

export async function extractLines(bytes: Uint8Array): Promise<PdfLine[]> {
  // Imported on demand: pdf.js is large and is only needed by whoever is
  // importing a statement, not on every application request.
  const { getDocumentProxy } = await import("unpdf");

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (error) {
    throw new ImportError(
      `Nao foi possivel abrir o PDF: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const lines: PdfLine[] = [];

  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const { items } = await page.getTextContent();

    const byLine = new Map<number, PdfCell[]>();

    for (const item of items) {
      if (!("str" in item) || item.str.trim() === "") continue;

      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      const width = "width" in item && typeof item.width === "number" ? item.width : 0;
      const key = Math.round(y / Y_TOLERANCE) * Y_TOLERANCE;

      const cell: PdfCell = { x, width, text: item.str };
      const cells = byLine.get(key);
      if (cells) cells.push(cell);
      else byLine.set(key, [cell]);
    }

    // y grows bottom-to-top in a PDF, so the reading order is descending.
    const ordered = [...byLine.entries()].sort(([a], [b]) => b - a);

    for (const [y, cells] of ordered) {
      const inOrder = [...cells].sort((a, b) => a.x - b.x);
      lines.push({
        page: number,
        y,
        indent: inOrder[0]!.x,
        text: join(inOrder),
        cells: group(inOrder),
      });
    }
  }

  return lines;
}

/**
 * Joins a line's chunks, gluing contiguous ones and separating columns with
 * a space.
 */
function join(cells: readonly PdfCell[]): string {
  let text = "";

  for (const [index, cell] of cells.entries()) {
    const previous = cells[index - 1];
    const contiguous =
      previous !== undefined && cell.x - (previous.x + previous.width) < COLUMN_THRESHOLD;

    if (index > 0 && !contiguous) text += " ";
    text += cell.text;
  }

  return text.replace(/\s+/g, " ").trim();
}

/**
 * Merges contiguous chunks into a single cell, so each cell in the line
 * corresponds to a real column.
 */
function group(cells: readonly PdfCell[]): PdfCell[] {
  const columns: PdfCell[] = [];

  for (const cell of cells) {
    const last = columns[columns.length - 1];
    const contiguous = last !== undefined && cell.x - (last.x + last.width) < COLUMN_THRESHOLD;

    if (contiguous) {
      columns[columns.length - 1] = {
        x: last.x,
        width: cell.x + cell.width - last.x,
        text: last.text + cell.text,
      };
    } else {
      columns.push(cell);
    }
  }

  return columns.map((column) => ({ ...column, text: column.text.trim() }));
}
