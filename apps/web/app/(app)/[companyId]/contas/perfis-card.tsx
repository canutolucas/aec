"use client";

/**
 * Gestao dos perfis (lentes gerenciais de contas) — pedido direto da
 * usuaria final: agrupar contas sob um nome ("Servicos por fora", "Contabil
 * empresarial") pra ver o app filtrado por essa lente. Fica em Contas
 * porque e sobre contas — quando a Fase 2 criar "Ajustes", muda pra la
 * (ver CLAUDE.md).
 */

import type { AccountProfileWithAccounts, BankAccount } from "@aec/db";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
} from "@aec/ui";
import { useState, useTransition } from "react";

import {
  arquivarPerfil,
  criarPerfil,
  editarContasDoPerfil,
  renomearPerfil,
} from "@/lib/db/account-profiles";

export function PerfisCard({
  companyId,
  podeEditar,
  contas,
  perfis,
}: {
  companyId: string;
  podeEditar: boolean;
  contas: readonly BankAccount[];
  perfis: readonly AccountProfileWithAccounts[];
}) {
  const [criando, setCriando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [arquivandoId, setArquivandoId] = useState<string | null>(null);

  if (!podeEditar && perfis.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Perfis de contas"
        action={
          podeEditar &&
          !criando && (
            <Button size="sm" variant="secondary" onClick={() => setCriando(true)}>
              Novo perfil
            </Button>
          )
        }
      />
      <p className="text-muted-foreground -mt-2 mb-4 text-xs">
        Agrupe contas sob um nome pra ver o app filtrado por essa lente — &ldquo;Servicos por
        fora&rdquo;, &ldquo;Contabil empresarial&rdquo;, o que fizer sentido pro seu negocio. Uma
        conta pode entrar em mais de um perfil. O seletor fica no cabecalho, ao lado do tema.
      </p>

      {criando && (
        <NovoPerfilForm
          companyId={companyId}
          contas={contas}
          onCancelar={() => setCriando(false)}
          onCriado={() => setCriando(false)}
        />
      )}

      {perfis.length === 0 && !criando ? (
        <EmptyState
          title="Nenhum perfil criado"
          description="Sem perfis, o app mostra sempre todas as contas juntas — crie um quando quiser enxergar um pedaco do negocio de cada vez."
        />
      ) : (
        <ul className="divide-border divide-y">
          {perfis.map((perfil) => (
            <li key={perfil.id} className="py-3">
              {editandoId === perfil.id ? (
                <EditarPerfilForm
                  companyId={companyId}
                  perfil={perfil}
                  contas={contas}
                  onCancelar={() => setEditandoId(null)}
                  onSalvo={() => setEditandoId(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{perfil.name}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {perfil.bankAccountIds.length === 0
                        ? "nenhuma conta"
                        : contas
                            .filter((conta) => perfil.bankAccountIds.includes(conta.id))
                            .map((conta) => conta.name)
                            .join(", ")}
                    </p>
                  </div>
                  {podeEditar && (
                    <div className="flex shrink-0 items-center gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setEditandoId(perfil.id)}
                        className="text-primary hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setArquivandoId(perfil.id)}
                        className="text-destructive hover:underline"
                      >
                        Arquivar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ArquivarPerfilDialog
        companyId={companyId}
        perfil={perfis.find((perfil) => perfil.id === arquivandoId) ?? null}
        onOpenChange={(open) => !open && setArquivandoId(null)}
      />
    </Card>
  );
}

function ContasCheckboxList({
  contas,
  selecionadas,
  onChange,
}: {
  contas: readonly BankAccount[];
  selecionadas: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="border-border grid gap-1.5 rounded-md border p-2 sm:grid-cols-2">
      {contas.map((conta) => (
        <label key={conta.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selecionadas.includes(conta.id)}
            onCheckedChange={() =>
              onChange(
                selecionadas.includes(conta.id)
                  ? selecionadas.filter((id) => id !== conta.id)
                  : [...selecionadas, conta.id],
              )
            }
          />
          <span className="truncate">{conta.name}</span>
        </label>
      ))}
    </div>
  );
}

function NovoPerfilForm({
  companyId,
  contas,
  onCancelar,
  onCriado,
}: {
  companyId: string;
  contas: readonly BankAccount[];
  onCancelar: () => void;
  onCriado: () => void;
}) {
  const [nome, setNome] = useState("");
  const [contasEscolhidas, setContasEscolhidas] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function salvar() {
    setErro(null);
    if (!nome.trim()) return setErro("Informe o nome do perfil.");
    if (contasEscolhidas.length === 0) return setErro("Escolha ao menos uma conta.");
    startTransition(async () => {
      const result = await criarPerfil(companyId, nome, contasEscolhidas);
      if (!result.ok) return setErro(result.error ?? "Nao foi possivel criar o perfil.");
      onCriado();
    });
  }

  return (
    <div className="border-border bg-muted/40 mb-4 grid gap-3 rounded-md border p-3">
      <Field label="Nome do perfil">
        <Input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Servicos por fora"
        />
      </Field>
      <Field label="Contas deste perfil">
        <ContasCheckboxList
          contas={contas}
          selecionadas={contasEscolhidas}
          onChange={setContasEscolhidas}
        />
      </Field>
      {erro && <Badge tone="error">{erro}</Badge>}
      <div className="flex gap-2">
        <Button size="sm" loading={isPending} onClick={salvar}>
          Criar perfil
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function EditarPerfilForm({
  companyId,
  perfil,
  contas,
  onCancelar,
  onSalvo,
}: {
  companyId: string;
  perfil: AccountProfileWithAccounts;
  contas: readonly BankAccount[];
  onCancelar: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(perfil.name);
  const [contasEscolhidas, setContasEscolhidas] = useState<string[]>([...perfil.bankAccountIds]);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function salvar() {
    setErro(null);
    if (!nome.trim()) return setErro("Informe o nome do perfil.");
    if (contasEscolhidas.length === 0) return setErro("Escolha ao menos uma conta.");
    startTransition(async () => {
      if (nome.trim() !== perfil.name) {
        const renomeado = await renomearPerfil(companyId, perfil.id, nome);
        if (!renomeado.ok) return setErro(renomeado.error ?? "Nao foi possivel renomear o perfil.");
      }
      const result = await editarContasDoPerfil(companyId, perfil.id, contasEscolhidas);
      if (!result.ok) return setErro(result.error ?? "Nao foi possivel salvar o perfil.");
      onSalvo();
    });
  }

  return (
    <div className="grid gap-3">
      <Field label="Nome do perfil">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} />
      </Field>
      <Field label="Contas deste perfil">
        <ContasCheckboxList
          contas={contas}
          selecionadas={contasEscolhidas}
          onChange={setContasEscolhidas}
        />
      </Field>
      {erro && <Badge tone="error">{erro}</Badge>}
      <div className="flex gap-2">
        <Button size="sm" loading={isPending} onClick={salvar}>
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function ArquivarPerfilDialog({
  companyId,
  perfil,
  onOpenChange,
}: {
  companyId: string;
  perfil: AccountProfileWithAccounts | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ConfirmDialog
      open={perfil !== null}
      onOpenChange={onOpenChange}
      title={`Arquivar "${perfil?.name}"?`}
      description="O perfil sai do seletor e para de filtrar qualquer tela. As contas e os lancamentos delas continuam intactos — nada e apagado."
      confirmLabel="Arquivar"
      tone="danger"
      onConfirm={() => {
        if (perfil) void arquivarPerfil(companyId, perfil.id);
      }}
    />
  );
}
