"use client";

/**
 * Integrantes da empresa: quem tem vinculo e com qual papel.
 *
 * Todo mundo com vinculo enxerga a lista (memberships_select ja permite),
 * mas so quem tem papel de owner ve os controles de adicionar/remover —
 * a mesma exigencia de memberships_write, aqui so por conveniencia de
 * navegacao.
 */

import { type MemberRole, ROLE_LABELS } from "@aec/db";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { adicionarIntegrante, alternarModoSimples, removerIntegrante } from "@/lib/db/equipe";
import { Alert, Button, Card, CardHeader, Field, Input, Select } from "@/lib/ui/components";

import type { MembershipWithProfile } from "./page";

const ROLES: readonly MemberRole[] = ["cliente_leitura", "assistente", "contador", "owner"];

interface Feedback {
  readonly text: string;
  readonly tone: "success" | "error";
}

export function EquipeClient({
  companyId,
  currentUserId,
  members,
  canManage,
}: {
  companyId: string;
  currentUserId: string;
  members: readonly MembershipWithProfile[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("assistente");

  function adicionar(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await adicionarIntegrante({ companyId, email: trimmed, role });
      setFeedback(
        result.ok
          ? { text: `${trimmed} adicionado(a) como ${ROLE_LABELS[role]}.`, tone: "success" }
          : { text: result.error ?? "Nao foi possivel adicionar.", tone: "error" },
      );
      if (result.ok) {
        setEmail("");
        router.refresh();
      }
    });
  }

  function remover(member: MembershipWithProfile) {
    const label = member.profiles?.full_name || member.profiles?.email || "esta pessoa";
    startTransition(async () => {
      const result = await removerIntegrante(companyId, member.user_id);
      setFeedback(
        result.ok
          ? { text: `${label} removido(a) da empresa.`, tone: "success" }
          : { text: result.error ?? "Nao foi possivel remover.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  function alternarSimples(member: MembershipWithProfile, simpleMode: boolean) {
    startTransition(async () => {
      const result = await alternarModoSimples(companyId, member.user_id, simpleMode);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Nao foi possivel salvar.", tone: "error" });
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      <Card>
        <CardHeader title={`Integrantes (${members.length})`} />
        {canManage && (
          <p className="text-muted-foreground border-border border-b px-4 py-2 text-xs">
            Modo simples: a pessoa so ve a tela de subir extrato, sem Painel, Lancamentos, Contas,
            Conciliacao, Relatorios ou Cadastros.
          </p>
        )}
        <div className="divide-border divide-y">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-medium">
                  {member.profiles?.full_name || member.profiles?.email || "—"}
                  {member.user_id === currentUserId && (
                    <span className="text-muted-foreground font-normal"> (voce)</span>
                  )}
                </p>
                {member.profiles?.full_name && member.profiles.email && (
                  <p className="text-muted-foreground text-xs">{member.profiles.email}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-xs">{ROLE_LABELS[member.role]}</span>
                {canManage && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={member.simple_mode}
                      disabled={isPending}
                      onChange={(event) => alternarSimples(member, event.target.checked)}
                    />
                    Modo simples
                  </label>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => remover(member)}
                  >
                    Remover
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {canManage && (
          <form
            onSubmit={adicionar}
            className="border-border grid gap-3 border-t p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
          >
            <Field
              label="E-mail"
              hint="A pessoa precisa ja ter uma conta criada (Supabase Auth) com este e-mail."
            >
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pessoa@exemplo.com.br"
                disabled={isPending}
              />
            </Field>
            <Field label="Papel">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as MemberRole)}
                disabled={isPending}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" size="sm" disabled={isPending || !email.trim()}>
              Adicionar
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
