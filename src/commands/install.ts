import * as readline from "readline";
import { loadConfig, saveConfig } from "../config";
import { checkHealth, fetchFeed, registerInstallation } from "../api";
import { saveFeedMessages } from "../cache";
import {
  detectClaude,
  installClaudeIntegration,
  armSpinnerMessage,
} from "../adapters/claude";
import { detectCodex, installCodexIntegration } from "../adapters/codex";
import { AgentType } from "../types";
import { t } from "../i18n";
import { withPingletLock } from "../lock";

/**
 * 기존 설정 교체 확인. Enter 또는 y면 진행(기본 Yes — 설치 의도가 명확하므로).
 * non-TTY(postinstall, CI)에서는 묻지 않고 false — 사용자 설정을 말없이
 * 바꾸지 않는다.
 */
function confirmReplace(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(false);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed === "" || /^y(es)?$/i.test(trimmed));
    }),
  );
}

export async function runInstall(args: string[]): Promise<void> {
  const force = args.includes("--force");
  // Claude는 기본 설치 대상. Codex는 TUI에 그릴 수 없어 OS 알림으로 전달하는
  // 방식인데 이게 체감상 시끄러워서, --codex를 명시한 경우에만(opt-in) 설치한다.
  const onlyClaude = args.includes("--claude");
  const onlyCodex = args.includes("--codex");
  const wantClaude = onlyClaude || !onlyCodex;
  const wantCodex = onlyCodex;
  const config = loadConfig();

  const apiIndex = args.indexOf("--api");
  if (apiIndex !== -1 && args[apiIndex + 1]) {
    config.apiBaseUrl = args[apiIndex + 1].replace(/\/$/, "");
    await withPingletLock(() => {
      const current = loadConfig();
      current.apiBaseUrl = config.apiBaseUrl;
      saveConfig(current);
    });
  }

  console.log("");
  const hasClaude = wantClaude && detectClaude();
  const hasCodex = wantCodex && detectCodex();
  console.log(hasClaude ? "✓ Claude Code detected" : "○ Claude Code not found");
  if (wantCodex) {
    console.log(hasCodex ? "✓ Codex detected" : "○ Codex not found");
  } else if (detectCodex()) {
    console.log(t("install.codexOptOut"));
  }

  if (!hasClaude && !hasCodex) {
    console.log(t("install.noTarget"));
    process.exitCode = 1;
    return;
  }

  const online = await checkHealth(config);
  if (!online) {
    console.log(t("install.offline", { api: config.apiBaseUrl }));
    console.log(t("install.offlineNote"));
  }

  const register = async (agentType: AgentType) => {
    if (config.installations[agentType] || !online) return;
    const record = await registerInstallation(config, agentType);
    if (record) {
      await withPingletLock(() => {
        const current = loadConfig();
        current.installations[agentType] = record;
        saveConfig(current);
      });
      config.installations[agentType] = record;
    }
  };

  if (hasClaude) {
    await register("CLAUDE");
    let result = (await withPingletLock(() => installClaudeIntegration(loadConfig(), { force })))!;
    if (!result.ok && result.needsForce) {
      const yes = await confirmReplace(t("install.askReplaceStatusLine"));
      if (yes) result = (await withPingletLock(() => installClaudeIntegration(loadConfig(), { force: true })))!;
    }
    console.log(
      result.ok
        ? "✓ Claude integration installed"
        : `✗ Claude integration skipped — ${result.reason}`,
    );
  }

  if (hasCodex) {
    await register("CODEX");
    let result = (await withPingletLock(() => installCodexIntegration(loadConfig(), { force })))!;
    if (!result.ok && result.needsForce) {
      const yes = await confirmReplace(t("install.askReplaceNotify"));
      if (yes) result = (await withPingletLock(() => installCodexIntegration(loadConfig(), { force: true })))!;
    }
    console.log(
      result.ok
        ? "✓ Codex integration installed (experimental)"
        : `✗ Codex integration skipped — ${result.reason}`,
    );
  }

  // 첫 feed를 미리 받아 로컬 캐시를 채워 둔다.
  const record = Object.values(config.installations)[0];
  if (online && record) {
    const messages = await fetchFeed(config, record);
    if (messages) {
      await withPingletLock(() => saveFeedMessages(messages));
      if (messages.length > 0) {
        console.log(`✓ Feed cached (${messages.length} messages)`);
        if (await withPingletLock(() => armSpinnerMessage(loadConfig(), messages[0] ?? null))) {
          console.log("✓ Claude spinner synced");
        }
      }
    }
  }

  const targets = [hasClaude && "claude", hasCodex && "codex"]
    .filter(Boolean)
    .join(t("install.or"));
  console.log(t("install.done", { targets }));
  console.log(t("install.doneDoctor"));
  console.log(t("install.donePost"));
  console.log(t("install.doneLogin"));
}
