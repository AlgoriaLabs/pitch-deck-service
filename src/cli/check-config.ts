// Validates an env file before a deploy switches to it: `node --env-file=<file> dist/cli/check-config.js`.
// Exit 0 and a summary when the config would start; exit 78 and the problems when it wouldn't, so the
// deploy stops while the old release keeps serving.

import { ConfigError, describeConfig, loadConfig } from "../config.js";

try {
  const config = loadConfig();
  console.log(describeConfig(config).map((line) => `  ${line}`).join("\n"));
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`✗ ${error.message}`);
  process.exit(78);
}
