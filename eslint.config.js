// Mechanical rules from CODING_STANDARDS.md. Judgement calls stay in that doc.
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["app/**/*.{ts,tsx}", "scripts/**/*.ts", "request-logger/**/*.ts"],
  extends: [tseslint.configs.base],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "TSAsExpression[expression.type='CallExpression'][expression.callee.property.name='get']",
        message:
          "Parse form data and search params with a zod schema instead of casting `.get(...)`. See CODING_STANDARDS.md.",
      },
    ],
  },
});
