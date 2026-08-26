import { useAccountBalances, useMyCompanies } from "@aec/db";
import { formatBRL, fromDb } from "@aec/domain";
import { Link, router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";

export default function DashboardScreen() {
  // Same hooks the web app's client-side screens use (packages/db), so the
  // query and its shape can't drift between the two surfaces.
  const companies = useMyCompanies(supabase);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Defaults to the first company once the list arrives, but only when
  // nothing has been picked yet — otherwise every refetch would snap the
  // selection back to index 0 while someone is looking at a different one.
  const company = companies.data?.find((c) => c.id === selectedId) ?? companies.data?.[0] ?? null;

  const balances = useAccountBalances(supabase, company?.id ?? "", {
    enabled: company !== null,
  });

  if (companies.isLoading) return <ActivityIndicator style={styles.center} color="#01416d" />;
  if (companies.error)
    return <Text style={styles.center}>Não foi possível carregar seus dados.</Text>;
  if (!company)
    return <Text style={styles.center}>Nenhuma empresa disponível para esta conta.</Text>;

  return (
    <View style={styles.page}>
      {(companies.data?.length ?? 0) > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.switcher}>
          {companies.data?.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setSelectedId(item.id)}
              style={[styles.pill, item.id === company.id && styles.pillActive]}
            >
              <Text style={item.id === company.id ? styles.pillTextActive : styles.pillText}>
                {item.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Text style={styles.company}>{company.name}</Text>
      <Text style={styles.title}>Saldos das contas</Text>
      {balances.isLoading ? (
        <ActivityIndicator color="#01416d" />
      ) : balances.error ? (
        <Text>Não foi possível carregar os saldos.</Text>
      ) : (
        (balances.data ?? []).map((account) => (
          <View key={account.bank_account_id} style={styles.card}>
            <Text>{account.name}</Text>
            <Text style={styles.money}>{formatBRL(fromDb(account.current_balance))}</Text>
          </View>
        ))
      )}
      <Link href={{ pathname: "/(app)/quick-entry", params: { companyId: company.id } }} asChild>
        <Button title="Lançamento rápido" color="#01416d" />
      </Link>
      <Button
        title="Sair"
        color="#8a6b43"
        onPress={() => void supabase.auth.signOut().then(() => router.replace("/login"))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, gap: 14, padding: 20, backgroundColor: "#f1f0ec" },
  center: { flex: 1, textAlign: "center", textAlignVertical: "center" },
  switcher: { flexGrow: 0 },
  pill: {
    borderWidth: 1,
    borderColor: "#d8d4cb",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginRight: 8,
    backgroundColor: "#fffdf7",
  },
  pillActive: { backgroundColor: "#01416d", borderColor: "#01416d" },
  pillText: { color: "#38566d", fontSize: 13 },
  pillTextActive: { color: "#f1f0ec", fontSize: 13, fontWeight: "600" },
  company: { color: "#38566d", fontSize: 15 },
  title: { color: "#01416d", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#d8d4cb",
    borderRadius: 8,
    padding: 16,
    backgroundColor: "#fffdf7",
  },
  money: { fontVariant: ["tabular-nums"], fontWeight: "700" },
});
