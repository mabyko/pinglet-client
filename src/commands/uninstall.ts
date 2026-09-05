import * as fs from "fs";
import { PINGLET_DIR, loadConfig, saveConfig } from "../config";
import { uninstallClaudeIntegration } from "../adapters/claude";
import { uninstallCodexIntegration } from "../adapters/codex";
import { t } from "../i18n";
import { releaseCredential } from "../api";
import { withPingletLock } from "../lock";
import { bindEvents, readEvents, quarantineEvents } from "../queue";
import { saveState } from "../cache";
import { runFlush } from "./flush";

export async function runUninstall(args: string[]): Promise<void> {
  const restored = await withPingletLock(() => {
    const config = loadConfig();
    bindEvents();
    const claudeRemoved = uninstallClaudeIntegration(config);
    const codexRemoved = uninstallCodexIntegration(config);
    saveState({ seen: {} });
    return { config, claudeRemoved, codexRemoved };
  });
  if (!restored) return;
  const { config, claudeRemoved, codexRemoved } = restored;
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

  await runFlush();
  for (const [agent, record] of Object.entries(config.installations)) {
    if (!await releaseCredential(config, "installation", record.token)) {
      throw new Error(t("uninstall.failed"));
    }
    await withPingletLock(() => {
      const pending = readEvents().filter(event => event.agentType === agent);
      quarantineEvents(pending, "uninstalled-before-upload");
      if (pending.length && !args.includes("--purge")) console.log(`○ ${pending.length} unsent events archived in events-quarantine.jsonl (not reassigned on reinstall)`);
      delete config.installations[agent as keyof typeof config.installations];
      saveConfig(config);
    });
  }
  // Also retire offline events produced before registration ever succeeded.
  await withPingletLock(() => {
    const pending = readEvents();
    quarantineEvents(pending, "uninstalled-without-registration");
    if (pending.length && !args.includes("--purge")) console.log(`○ ${pending.length} unregistered events archived in events-quarantine.jsonl`);
  });
  if (config.userToken) {
    if (!await releaseCredential(config, "user", config.userToken)) {
      throw new Error(t("uninstall.failed"));
    }
    delete config.userToken;
    await withPingletLock(() => saveConfig(config));
  }

  if (args.includes("--purge")) {
    await withPingletLock(() => fs.rmSync(PINGLET_DIR, { recursive: true, force: true }));
    console.log("✓ ~/.pinglet removed (config / cache / event queue)");
  } else {
    console.log(t("uninstall.keep"));
  }
  console.log(t("uninstall.npm"));
}
