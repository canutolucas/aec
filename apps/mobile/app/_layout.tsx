import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
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
