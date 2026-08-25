"use client";

/**
 * Lancamento rapido.
 *
 * Esta e a tela que compete com o Excel, e a comparacao e no tempo por
 * lancamento. Por isso: o foco volta sozinho para o valor depois de gravar, a
 * data e a conta permanecem entre lancamentos (quem alimenta diariamente lanca
 * varios do mesmo dia em sequencia), e Enter grava sem tirar a mao do teclado.
 */

import type { BankAccount, Category } from "@aec/db";
import { useRef, useState, useTransition } from "react";

import { criarLancamento } from "@/lib/db/transactions";
import { Alert, Button, Field, Input, Select } from "@/lib/ui/components";

export function LancamentoRapido({
  companyId,
  contas,
  categorias,
  hoje,
}: {
  companyId: string;
  contas: readonly BankAccount[];
  categorias: readonly Category[];
  hoje: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  // Persistem entre lancamentos: quem alimenta diariamente lanca varios do mesmo
  // dia, na mesma conta. Zerar isso a cada gravacao dobraria o trabalho.
  const [data, setData] = useState(hoje);
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [sentido, setSentido] = useState<"entrada" | "saida">("saida");
  const [status, setStatus] = useState<"realizado" | "previsto">("realizado");

  const valorRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function gravar(formData: FormData) {
    setErro(null);
    setSucesso(null);

    iniciar(async () => {
      const resultado = await criarLancamento({
        companyId,
        bankAccountId: contaId,
        bookingDate: data,
        amount: String(formData.get("valor") ?? ""),
        direction: sentido,
        status,
        description: String(formData.get("descricao") ?? ""),
        categoryId: String(formData.get("categoria") ?? "") || null,
        documentNumber: String(formData.get("documento") ?? "") || null,
      });

      if (!resultado.ok) {
        setErro(resultado.error ?? "Nao foi possivel gravar.");
        return;
      }

      setSucesso("Lancamento gravado.");
      // Limpa so o que muda de um lancamento para o outro.
      formRef.current?.reset();
      valorRef.current?.focus();
    });
  }

  if (contas.length === 0) {
    return (
      <Alert tone="warn" title="Cadastre uma conta primeiro">
        Nao ha conta bancaria nesta empresa. Sem conta nao ha onde lancar.
      </Alert>
    );
  }

  // Categoria de resultado so faz sentido no sentido correspondente: oferecer
  // uma categoria de receita para uma saida so produziria erro na gravacao.
  const categoriasDoSentido = categorias.filter(
    (categoria) => categoria.kind === "ambos" || categoria.kind === sentido,
  );

  return (
    <form ref={formRef} action={gravar} className="space-y-4 p-4">
      {erro && <Alert tone="error">{erro}</Alert>}
      {sucesso && !erro && <Alert tone="success">{sucesso}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Data">
          <Input
            type="date"
            value={data}
            onChange={(event) => setData(event.target.value)}
            required
          />
        </Field>

        <Field label="Conta">
          <Select value={contaId} onChange={(event) => setContaId(event.target.value)} required>
            {contas.map((conta) => (
              <option key={conta.id} value={conta.id}>
                {conta.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sentido">
          <Select
            value={sentido}
            onChange={(event) => setSentido(event.target.value as "entrada" | "saida")}
          >
            <option value="saida">Saida</option>
            <option value="entrada">Entrada</option>
          </Select>
        </Field>

        <Field label="Valor">
          <Input
            ref={valorRef}
            name="valor"
            inputMode="decimal"
            placeholder="0,00"
            required
            autoFocus
            className="tabular-money"
          />
        </Field>

        <Field label="Situacao">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as "realizado" | "previsto")}
          >
            <option value="realizado">Realizado</option>
            <option value="previsto">Previsto (a pagar/receber)</option>
          </Select>
        </Field>

        <Field label="Documento">
          <Input name="documento" placeholder="NF, boleto..." />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
        <Field label="Descricao">
          <Input name="descricao" required placeholder="Do que se trata" />
        </Field>

        <Field label="Categoria">
          <Select name="categoria" defaultValue="">
            <option value="">Sem categoria</option>
            {categoriasDoSentido.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-end">
          <Button type="submit" disabled={pendente}>
            {pendente ? "Gravando..." : "Lancar"}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Data, conta e sentido permanecem depois de gravar, para lancar varios seguidos. O valor
        aceita 1.234,56 ou 1234.56.
      </p>
    </form>
  );
}
