import type { BankAccount, Company } from "@aec/db";
import { parseUserInput, toDb } from "@aec/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

import { supabase } from "@/lib/supabase";

async function loadEntryContext() {
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("companies (id, name, legal_name, tax_id, timezone, is_active)")
    .limit(1);
  if (membershipError) throw membershipError;
  const company = memberships?.[0]?.companies as unknown as Company | null;
  if (!company) return { company: null, accounts: [] as BankAccount[] };
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return { company, accounts: (data ?? []) as BankAccount[] };
}

export default function QuickEntryScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["mobile-entry-context"],
    queryFn: loadEntryContext,
  });
  const [accountIndex, setAccountIndex] = useState(0);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"entrada" | "saida">("saida");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const account = data?.accounts[accountIndex];

  async function save() {
    if (!data?.company || !account) return;
    setError(null);
    let cents: number;
    try {
      cents = Math.abs(parseUserInput(amount));
    } catch {
      setError("Informe um valor válido.");
      return;
    }
    if (cents === 0 || !description.trim()) {
      setError("Informe a descrição e um valor diferente de zero.");
      return;
    }

    setSaving(true);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { error: insertError } = await supabase.from("transactions").insert({
      company_id: data.company.id,
      bank_account_id: account.id,
      booking_date: today,
      competence_date: today,
      amount: toDb(direction === "saida" ? -cents : cents),
      status: "realizado",
      description: description.trim(),
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["mobile-dashboard"] });
    router.back();
  }

  if (isLoading) return <Text style={styles.page}>Carregando...</Text>;

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Lançamento rápido</Text>
      {data?.accounts.map((item, index) => (
        <Button
          key={item.id}
          title={`${accountIndex === index ? "✓ " : ""}${item.name}`}
          color={accountIndex === index ? "#01416d" : "#8a6b43"}
          onPress={() => setAccountIndex(index)}
        />
      ))}
      <TextInput
        style={styles.input}
        placeholder="Descrição"
        value={description}
        onChangeText={setDescription}
      />
      <TextInput
        style={styles.input}
        placeholder="Valor (ex.: 1.234,56)"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
      />
      <View style={styles.direction}>
        <Button
          title="Saída"
          color={direction === "saida" ? "#b52e2e" : "#8a6b43"}
          onPress={() => setDirection("saida")}
        />
        <Button
          title="Entrada"
          color={direction === "entrada" ? "#16774f" : "#8a6b43"}
          onPress={() => setDirection("entrada")}
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Button
        title={saving ? "Salvando..." : "Salvar lançamento"}
        disabled={saving || !account}
        color="#01416d"
        onPress={() => void save()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, gap: 14, padding: 20, backgroundColor: "#f1f0ec" },
  title: { color: "#01416d", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#d8d4cb",
    borderRadius: 8,
    padding: 13,
    backgroundColor: "#fffdf7",
    fontSize: 16,
  },
  direction: { flexDirection: "row", justifyContent: "space-around", gap: 10 },
  error: { color: "#b52e2e" },
});
