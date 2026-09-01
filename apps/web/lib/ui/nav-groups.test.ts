import { describe, expect, it } from "vitest";

import { NAV_GROUPS, topLevelNav, visibleItems } from "./nav-groups";

describe("topLevelNav", () => {
  it("sempre tem Hoje primeiro, depois um item por grupo", () => {
    const nav = topLevelNav("owner", false);
    expect(nav.map((item) => item.key)).toEqual([
      "hoje",
      "movimentos",
      "notas",
      "relatorios",
      "ajustes",
    ]);
  });

  it("o item de cada grupo leva pra primeira aba visivel daquele grupo", () => {
    // Owner, modo avancado: primeira aba de Ajustes e Contas.
    const nav = topLevelNav("owner", false);
    const ajustes = nav.find((item) => item.key === "ajustes")!;
    expect(ajustes.href("empresa-1")).toBe(NAV_GROUPS.ajustes.items[0]!.href("empresa-1"));
  });
});

describe("visibleItems — Ajustes", () => {
  it("modo avancado + owner ve as 4 abas", () => {
    expect(visibleItems(NAV_GROUPS.ajustes, "owner", false).map((i) => i.key)).toEqual([
      "contas",
      "cadastros",
      "regras",
      "equipe",
    ]);
  });

  it("modo simples esconde Cadastros mesmo pra owner", () => {
    expect(visibleItems(NAV_GROUPS.ajustes, "owner", true).map((i) => i.key)).toEqual([
      "contas",
      "regras",
      "equipe",
    ]);
  });

  it("assistente nunca ve Equipe, com ou sem modo simples", () => {
    expect(visibleItems(NAV_GROUPS.ajustes, "assistente", false).map((i) => i.key)).toEqual([
      "contas",
      "cadastros",
      "regras",
    ]);
    expect(visibleItems(NAV_GROUPS.ajustes, "assistente", true).map((i) => i.key)).toEqual([
      "contas",
      "regras",
    ]);
  });

  it("cliente_leitura nunca ve Equipe, e Cadastros so some no modo simples (a aba e so leitura pra ele, RLS decide o resto)", () => {
    expect(visibleItems(NAV_GROUPS.ajustes, "cliente_leitura", false).map((i) => i.key)).toEqual([
      "contas",
      "cadastros",
      "regras",
    ]);
    expect(visibleItems(NAV_GROUPS.ajustes, "cliente_leitura", true).map((i) => i.key)).toEqual([
      "contas",
      "regras",
    ]);
  });
});

describe("visibleItems — Relatórios", () => {
  it("Auditoria so aparece a partir de contador (RLS de audit_log so deixa contador+ ler)", () => {
    expect(visibleItems(NAV_GROUPS.relatorios, "contador", false).map((i) => i.key)).toContain(
      "auditoria",
    );
    expect(visibleItems(NAV_GROUPS.relatorios, "owner", false).map((i) => i.key)).toContain(
      "auditoria",
    );
    expect(
      visibleItems(NAV_GROUPS.relatorios, "assistente", false).map((i) => i.key),
    ).not.toContain("auditoria");
    expect(
      visibleItems(NAV_GROUPS.relatorios, "cliente_leitura", false).map((i) => i.key),
    ).not.toContain("auditoria");
  });
});

describe("visibleItems — Movimentos e Notas nunca somem", () => {
  it("todo papel e todo modo veem as 5 abas de Movimentos", () => {
    for (const role of ["cliente_leitura", "assistente", "contador", "owner"] as const) {
      for (const simpleMode of [false, true]) {
        expect(visibleItems(NAV_GROUPS.movimentos, role, simpleMode)).toHaveLength(5);
      }
    }
  });

  it("todo papel e todo modo veem as 2 abas de Notas", () => {
    for (const role of ["cliente_leitura", "assistente", "contador", "owner"] as const) {
      for (const simpleMode of [false, true]) {
        expect(visibleItems(NAV_GROUPS.notas, role, simpleMode)).toHaveLength(2);
      }
    }
  });
});
