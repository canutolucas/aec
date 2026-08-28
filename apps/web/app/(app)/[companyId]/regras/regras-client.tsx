"use client";

/**
 * Versao desta tela pra quem esta em modo simples (ver page.tsx) — mesma
 * lista de /cadastros, mas com um texto de abertura que nao pressupoe o
 * jargao "avancado": esta pessoa nunca viu a palavra "regra de
 * categorizacao" antes de chegar aqui.
 */

import type { Category, MatchingRule } from "@aec/db";
import { Alert, Card, CardHeader } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { desativarRegra } from "@/lib/db/cadastros";

import { RegrasList } from "../cadastros/regras-list";

interface Feedback {
  readonly text: string;
  readonly tone: "success" | "error";
}

export function RegrasClient({
  companyId,
  categories,
  matchingRules,
  canEdit,
}: {
  companyId: string;
  categories: readonly Category[];
  matchingRules: readonly MatchingRule[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPending, startTransition] = useTransition();

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  function deactivate(rule: MatchingRule) {
    startTransition(async () => {
      const result = await desativarRegra(companyId, rule.id);
      setFeedback(
        result.ok
          ? { text: "Regra desativada.", tone: "success" }
          : { text: result.error ?? "Nao foi possivel desativar.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Regras automaticas</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Toda vez que voce escolhe uma categoria na tela de Inicio, o sistema guarda essa escolha
          como uma regra — na proxima vez que um lancamento parecido aparecer, ele ja vem
          categorizado sozinho. Se uma regra passou a categorizar errado (o fornecedor mudou de
          nome, ou foi um engano na hora de escolher), desative-a aqui.
        </p>
      </div>

      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      <Card>
        <CardHeader title={`Regras ativas (${matchingRules.length})`} />
        <RegrasList
          companyId={companyId}
          matchingRules={matchingRules}
          categoryNameById={categoryNameById}
          canEdit={canEdit}
          disabled={isPending}
          onDeactivate={deactivate}
        />
      </Card>
    </div>
  );
}
