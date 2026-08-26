import { resolveBankBrand } from "../lib/bank-brands";

/**
 * Selo colorido com as iniciais do banco, ao lado do nome da conta — ajuda a
 * reconhecer "de que banco e essa conta" num piscar de olhos numa lista, sem
 * reproduzir o logotipo de ninguem (ver bank-brands.ts).
 *
 * Retorna null quando nao ha nome de banco, para o chamador decidir se
 * renderiza algo no lugar (mesmo comportamento de resolveBankBrand).
 */
export function BankBadge({ bankName }: { bankName: string | null | undefined }) {
  const brand = resolveBankBrand(bankName);
  if (!brand) return null;

  return (
    <span
      title={brand.label}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-semibold tracking-tight"
      style={{ backgroundColor: brand.background, color: brand.foreground }}
    >
      {brand.initials}
    </span>
  );
}
