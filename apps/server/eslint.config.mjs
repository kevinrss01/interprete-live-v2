import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommended,
  // Best-effort cleanup (closing sockets, reading provider error bodies) is intentional.
  { rules: { "no-empty": ["error", { allowEmptyCatch: true }] } },
  { ignores: ["dist/**"] },
);
