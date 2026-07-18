// Flat ESLint config. eslint-config-next ships native flat-config arrays as of
// Next 16, so we spread them directly - no @eslint/eslintrc FlatCompat shim.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**"],
  },
];

export default eslintConfig;
