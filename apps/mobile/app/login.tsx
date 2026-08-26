import { router } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

import { supabase } from "@/lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) setError(signInError.message);
    else router.replace("/(app)");
  }

  return (
    <View style={styles.page}>
      <Text style={styles.brand}>Controle Bancário</Text>
      <Text style={styles.subtitle}>
        Acesse suas empresas e lance movimentos em poucos segundos.
      </Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="E-mail"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        secureTextEntry
        placeholder="Senha"
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button
        title={loading ? "Entrando..." : "Entrar"}
        disabled={loading || !email || !password}
        onPress={() => void signIn()}
        color="#01416d"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", gap: 14, padding: 24, backgroundColor: "#f1f0ec" },
  brand: { color: "#01416d", fontSize: 26, fontWeight: "700" },
  subtitle: { color: "#38566d", fontSize: 15, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#d8d4cb",
    borderRadius: 8,
    backgroundColor: "#fffdf7",
    padding: 13,
    fontSize: 16,
  },
  error: { color: "#b52e2e" },
});
