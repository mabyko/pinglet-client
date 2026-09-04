import { loadConfig } from "../config";
import { checkHealth } from "../api";
import { feedAgeMs, loadFeedMessages } from "../cache";
import { countEvents } from "../queue";
import {
  detectClaude,
  isClaudeIntegrationInstalled,
  spinnerVerbsStatus,
} from "../adapters/claude";
import { detectCodex, isCodexIntegrationInstalled } from "../adapters/codex";
import { t } from "../i18n";

const ok = (label: string) => console.log(`✓ ${label}`);
const warn = (label: string) => console.log(`○ ${label}`);
const bad = (label: string) => console.log(`✗ ${label}`);

export async function runDoctor(): Promise<void> {
  const config = loadConfig();
  console.log("");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 18) ok(`Node.js ${process.versions.node}`);
  else bad(t("doctor.nodeOld", { version: process.versions.node }));

  // Claude
  if (detectClaude()) {
    ok("Claude Code detected");
    if (isClaudeIntegrationInstalled()) {
      ok("Claude integration installed");
      const spinner = spinnerVerbsStatus();
      if (spinner.count > 0) {
        ok(t("doctor.spinnerCount", { n: spinner.count }));
      } else {
        warn(t("doctor.spinnerMissing"));
      }
    } else warn(t("doctor.claudeNotInstalled"));
  } else {
    warn("Claude Code not found");
  }

  // Codex
  if (detectCodex()) {
    ok("Codex detected");
    if (isCodexIntegrationInstalled()) ok("Codex integration installed");
    else warn(t("doctor.codexNotInstalled"));
  } else {
    warn("Codex not found");
  }

  // 서버 등록 상태
  for (const agentType of ["CLAUDE", "CODEX"] as const) {
    const record = config.installations[agentType];
    if (record) ok(`${agentType} installation registered (${record.installationId})`);
  }
  if (Object.keys(config.installations).length === 0) {
    warn(t("doctor.noInstallation"));
  }

  // 로컬 캐시 / 큐
  const messages = loadFeedMessages();
  const age = feedAgeMs();
  if (messages.length === 0) {
    warn(t("doctor.feedEmpty"));
  } else {
    const ageMin = age === null ? "?" : Math.round(age / 60_000);
    ok(t("doctor.feedCache", { n: messages.length, min: ageMin }));
  }
  const queued = countEvents();
  if (queued < 200) ok(t("doctor.queue", { n: queued }));
  else warn(t("doctor.queueBacklog", { n: queued }));

  // API
  const online = await checkHealth(config);
  if (online) ok(`API reachable (${config.apiBaseUrl})`);
  else warn(t("doctor.apiUnreachable", { api: config.apiBaseUrl }));

  if (config.userToken) ok(t("doctor.loggedIn"));
  else warn(t("doctor.notLoggedIn"));
  console.log("");
}
