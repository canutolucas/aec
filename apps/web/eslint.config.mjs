import next from "eslint-config-next";

/**
 * eslint-config-next 16 already exports native flat config, so there's
 * nothing to adapt with FlatCompat.
 */
const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
