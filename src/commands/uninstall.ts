import * as fs from "fs";
import { PINGLET_DIR, loadConfig, saveConfig } from "../config";
import { uninstallClaudeIntegration } from "../adapters/claude";
import { uninstallCodexIntegration } from "../adapters/codex";
import { t } from "../i18n";
import { releaseCredential } from "../api";

export async function runUninstall(args: string[]): Promise<void> {
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

  for (const [agent, record] of Object.entries(config.installations)) {
    if (!await releaseCredential(config, "installation", record.token)) {
      throw new Error(t("uninstall.failed"));
    }
    delete config.installations[agent as keyof typeof config.installations];
    saveConfig(config);
  }
  if (config.userToken) {
    if (!await releaseCredential(config, "user", config.userToken)) {
      throw new Error(t("uninstall.failed"));
    }
    delete config.userToken;
    saveConfig(config);
  }

  if (args.includes("--purge")) {
    fs.rmSync(PINGLET_DIR, { recursive: true, force: true });
    console.log("✓ ~/.pinglet removed (config / cache / event queue)");
  } else {
    console.log(t("uninstall.keep"));
  }
  console.log(t("uninstall.npm"));
}
