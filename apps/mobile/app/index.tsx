import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { supabase } from "@/lib/supabase";

/**
 * Checks for a persisted session before deciding where to send the person.
 *
 * The Supabase client is configured with persistSession/autoRefreshToken
 * backed by expo-secure-store specifically so a session survives the app
 * being closed and reopened — an unconditional redirect to /login here
 * would make that configuration pointless, forcing a fresh sign-in on
 * every cold start even with a perfectly valid stored session.
 */
export default function Index() {
  const [target, setTarget] = useState<"/login" | "/(app)" | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setTarget(data.session ? "/(app)" : "/login");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#01416d" />
      </View>
    );
  }

  return <Redirect href={target} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f0ec" },
});
