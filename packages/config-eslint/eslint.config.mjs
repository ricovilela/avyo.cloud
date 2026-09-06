// ESLint 9 auto-detects `eslint.config.mjs`; this package lints itself with the
// very config it exports, keeping it consistent with every consuming workspace.
import config from "./index.mjs";

export default config;
