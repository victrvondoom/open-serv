import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", ".next-*/**", "src/generated/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];
export default config;
