import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypeScript,
  {
    ignores: [".next/**", ".next-dev/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    // React 19's new compiler-oriented rules require broad state-lifecycle
    // refactors. Keep the existing lint contract during the framework security
    // upgrade; enable these incrementally as those components are redesigned.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
