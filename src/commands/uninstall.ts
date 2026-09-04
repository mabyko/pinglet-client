import * as fs from "fs";
import { PINGLET_DIR, loadConfig } from "../config";
import { uninstallClaudeIntegration } from "../adapters/claude";
import { uninstallCodexIntegration } from "../adapters/codex";
import { t } from "../i18n";

export function runUninstall(args: string[]): void {
  const config = loadConfig();

  const claudeRemoved = uninstallClaudeIntegration(config);
  const codexRemoved = uninstallCodexIntegration(config);
  console.log(
    claudeRemoved
      ? "✓ Claude integration removed"
      : "○ Claude integration not installed",
  );
  console.log(
    codexRemoved
      ? "✓ Codex integration removed"
      : "○ Codex integration not installed",
  );

  if (args.includes("--purge")) {
    fs.rmSync(PINGLET_DIR, { recursive: true, force: true });
    console.log("✓ ~/.pinglet removed (config / cache / event queue)");
  } else {
    console.log(t("uninstall.keep"));
  }
}
