import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  // The mirror image of the session check in index.tsx: if the session is
  // ever lost while the app is open (sign-out from this or a signed-in
  // action, a refresh token that stops working), send the person back to
  // login instead of leaving them stuck on a screen whose queries will now
  // fail RLS silently.
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Stack
        screenOptions={{ headerStyle: { backgroundColor: "#01416d" }, headerTintColor: "#f1f0ec" }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Entrar" }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </QueryClientProvider>
  );
}
