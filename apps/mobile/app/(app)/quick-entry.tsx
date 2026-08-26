import { queryKeys, useBankAccounts } from "@aec/db";
import { parseUserInput, toDb } from "@aec/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

import { supabase } from "@/lib/supabase";

export default function QuickEntryScreen() {
  // companyId comes from the dashboard's own company switcher — this screen
  // never re-derives "the" company on its own, so it can never disagree with
  // whichever company the person was actually looking at.
  const { companyId } = useLocalSearchParams<{ companyId: string }>();
  const queryClient = useQueryClient();
  const accounts = useBankAccounts(supabase, companyId ?? "", { enabled: !!companyId });

  const [accountIndex, setAccountIndex] = useState(0);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"entrada" | "saida">("saida");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const account = accounts.data?.[accountIndex];

  async function save() {
    if (!companyId || !account) return;
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
      company_id: companyId,
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
    await queryClient.invalidateQueries({ queryKey: queryKeys.accountBalances(companyId) });
    router.back();
  }

  // A disabled query (no companyId) reports isLoading=false, not true — so
  // this has to be its own check, or a stale/absent route param (a cold
  // start replaying navigation state, a future deep link) would render a
  // blank screen with no accounts, no error, and a silently disabled save
  // button instead of telling the person what to do.
  if (!companyId) {
    return (
      <View style={styles.page}>
        <Text style={styles.error}>
          Não foi possível identificar a empresa. Volte ao painel e tente de novo.
        </Text>
        <Button title="Voltar" color="#01416d" onPress={() => router.back()} />
      </View>
    );
  }

  if (accounts.isLoading) return <Text style={styles.page}>Carregando...</Text>;

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Lançamento rápido</Text>
      {accounts.data?.map((item, index) => (
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
