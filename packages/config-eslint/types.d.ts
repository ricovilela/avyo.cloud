// Ambient declarations for dependencies that ship no TypeScript types.
//
// `eslint-config-prettier` (v9.x) publishes a plain CommonJS module with no
// bundled `.d.ts` and no `@types/*` package, so `checkJs` type-checking of our
// flat config fails with TS7016. It is a flat-config-compatible config object,
// so we declare it as an ESLint `Linter.Config` for accurate typing.
declare module "eslint-config-prettier" {
  import type { Linter } from "eslint";
  const config: Linter.Config;
  export default config;
}
