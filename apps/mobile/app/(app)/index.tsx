import type { AccountBalance, Company } from "@aec/db";
import { formatBRL, fromDb } from "@aec/domain";
import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";

import { supabase } from "@/lib/supabase";

async function loadDashboard() {
  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("companies (id, name, legal_name, tax_id, timezone, is_active)")
    .limit(1);
  if (membershipError) throw membershipError;
  const company = memberships?.[0]?.companies as unknown as Company | null;
  if (!company) return { company: null, accounts: [] as AccountBalance[] };

  const { data, error } = await supabase
    .from("v_account_balances")
    .select("*")
    .eq("company_id", company.id)
    .order("name");
  if (error) throw error;
  return { company, accounts: (data ?? []) as AccountBalance[] };
}

export default function DashboardScreen() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["mobile-dashboard"],
    queryFn: loadDashboard,
  });
  if (isLoading) return <ActivityIndicator style={styles.center} color="#01416d" />;
  if (error) return <Text style={styles.center}>Não foi possível carregar seus dados.</Text>;
  if (!data?.company)
    return <Text style={styles.center}>Nenhuma empresa disponível para esta conta.</Text>;

  return (
    <View style={styles.page}>
      <Text style={styles.company}>{data.company.name}</Text>
      <Text style={styles.title}>Saldos das contas</Text>
      {data.accounts.map((account) => (
        <View key={account.bank_account_id} style={styles.card}>
          <Text>{account.name}</Text>
          <Text style={styles.money}>{formatBRL(fromDb(account.current_balance))}</Text>
        </View>
      ))}
      <Link href="/(app)/quick-entry" asChild>
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
