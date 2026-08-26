/**
 * Cores de marca dos bancos mais comuns para uma cliente de assessoria
 * contabil brasileira, para o selo ao lado do nome da conta.
 *
 * Deliberadamente NAO tenta reproduzir o logotipo de cada banco — so a cor
 * principal da marca, com as iniciais: um jeito comum e seguro de
 * identificar visualmente "de que banco e essa conta" sem usar a marca
 * registrada de ninguem.
 *
 * Cores conferidas via busca (Itau, Bradesco, Banco do Brasil, Caixa,
 * Santander, Nubank, Sicredi) contra o hex oficial ou o mais consistente
 * entre fontes de marca; as demais (Inter, Cora, Sicoob, BTG, C6, PagBank,
 * Banrisul) sao aproximacoes de boa-fe — os sites oficiais desses bancos nao
 * sao alcancaveis desta rede para conferir o hex exato, e nenhuma delas e
 * garantia de bater pixel a pixel com o guia de marca oficial.
 *
 * `bank_name` e texto livre (quem cadastra a conta digita, sem lista
 * fechada), entao o casamento e por palavra-chave contida no nome digitado,
 * nao por igualdade exata — "Banco Itau S.A.", "ITAU" e "itau unibanco"
 * batem todos na mesma entrada.
 */

export interface BankBrand {
  readonly label: string;
  readonly background: string;
  readonly foreground: string;
  readonly initials: string;
}

interface BankBrandEntry extends BankBrand {
  readonly keywords: readonly string[];
}

const BANK_BRANDS: readonly BankBrandEntry[] = [
  {
    keywords: ["itau"],
    label: "Itaú",
    background: "#FF6200",
    foreground: "#FFFFFF",
    initials: "I",
  },
  {
    keywords: ["bradesco"],
    label: "Bradesco",
    background: "#CC092F",
    foreground: "#FFFFFF",
    initials: "B",
  },
  {
    keywords: ["brasil"],
    label: "Banco do Brasil",
    background: "#FEED08",
    foreground: "#0061AA",
    initials: "BB",
  },
  {
    keywords: ["caixa"],
    label: "Caixa",
    background: "#1C60AB",
    foreground: "#FFFFFF",
    initials: "CX",
  },
  {
    keywords: ["santander"],
    label: "Santander",
    background: "#EC0000",
    foreground: "#FFFFFF",
    initials: "S",
  },
  {
    keywords: ["nubank", "nu pagamentos", "nu bank"],
    label: "Nubank",
    background: "#820AD1",
    foreground: "#FFFFFF",
    initials: "Nu",
  },
  {
    keywords: ["inter"],
    label: "Inter",
    background: "#FF7A00",
    foreground: "#FFFFFF",
    initials: "in",
  },
  {
    keywords: ["cora"],
    label: "Cora",
    background: "#151515",
    foreground: "#D4FF4F",
    initials: "Cr",
  },
  {
    keywords: ["sicoob"],
    label: "Sicoob",
    background: "#00995D",
    foreground: "#FFFFFF",
    initials: "Sb",
  },
  {
    keywords: ["sicredi"],
    label: "Sicredi",
    background: "#3FA110",
    foreground: "#FFFFFF",
    initials: "Sd",
  },
  {
    keywords: ["btg"],
    label: "BTG Pactual",
    background: "#0A0A0A",
    foreground: "#D4B26A",
    initials: "BTG",
  },
  {
    keywords: ["c6"],
    label: "C6 Bank",
    background: "#1B1B1B",
    foreground: "#FFDD00",
    initials: "C6",
  },
  {
    keywords: ["pagbank", "pagseguro"],
    label: "PagBank",
    background: "#00A868",
    foreground: "#FFFFFF",
    initials: "Pag",
  },
  {
    keywords: ["banrisul"],
    label: "Banrisul",
    background: "#00549F",
    foreground: "#FFFFFF",
    initials: "Bn",
  },
];

// Paleta neutra, deterministica por nome, para um banco fora da lista acima
// — cada nome desconhecido ainda ganha uma cor propria e estavel (o mesmo
// nome sempre cai na mesma cor), em vez de todos caindo no mesmo cinza.
const FALLBACK_PALETTE: readonly { background: string; foreground: string }[] = [
  { background: "#3B5BDB", foreground: "#FFFFFF" },
  { background: "#0B8457", foreground: "#FFFFFF" },
  { background: "#9C36B5", foreground: "#FFFFFF" },
  { background: "#E8590C", foreground: "#FFFFFF" },
  { background: "#1864AB", foreground: "#FFFFFF" },
  { background: "#5F3DC4", foreground: "#FFFFFF" },
];

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Resolve um nome de banco (texto livre) para um selo de marca, com fallback determinístico. */
export function resolveBankBrand(bankName: string | null | undefined): BankBrand | null {
  const trimmed = bankName?.trim();
  if (!trimmed) return null;

  const normalized = normalize(trimmed);
  const known = BANK_BRANDS.find((brand) =>
    brand.keywords.some((keyword) => normalized.includes(keyword)),
  );
  if (known) return known;

  const fallback = FALLBACK_PALETTE[hashString(normalized) % FALLBACK_PALETTE.length]!;
  return { label: trimmed, initials: initialsFrom(trimmed), ...fallback };
}
