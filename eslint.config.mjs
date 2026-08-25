import next from "eslint-config-next";

/**
 * eslint-config-next 16 ja exporta flat config nativo, entao nao ha o que
 * adaptar com FlatCompat.
 */
const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "supabase/.temp/**", "next-env.d.ts"],
  },
];

export default config;
