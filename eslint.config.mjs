import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typedProjects = [
  "./apps/api/tsconfig.json",
  "./apps/desktop/tsconfig.eslint.json",
  "./apps/runner/tsconfig.json",
  "./packages/adapters/tsconfig.json",
  "./packages/db/tsconfig.json",
  "./packages/schema/tsconfig.json",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.worktrees/**",
      "**/.vercel/**",
      "**/output/**",
      "api/.generated/**",
      ".agent-memory/**",
      "docs/audits/**",
    ],
  },
  {
    files: ["scripts/**/*.mjs", "**/*.config.mjs"],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/**/*.{ts,tsx,cts}", "packages/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "apps/*/src/**/*.{ts,tsx,cts}",
      "packages/*/src/**/*.ts",
    ],
    languageOptions: {
      parserOptions: {
        project: typedProjects,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
);
