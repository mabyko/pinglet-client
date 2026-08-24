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
    saveConfig(config);
  }

  console.log("");
  const hasClaude = wantClaude && detectClaude();
  const hasCodex = wantCodex && detectCodex();
  console.log(hasClaude ? "✓ Claude Code detected" : "○ Claude Code not found");
  if (wantCodex) {
    console.log(hasCodex ? "✓ Codex detected" : "○ Codex not found");
  } else if (detectCodex()) {
    console.log(
      "○ Codex 감지됨 — OS 알림 방식이라 기본 설치에서 제외합니다 (원하면 pinglet install --codex)",
    );
  }

  if (!hasClaude && !hasCodex) {
    console.log("\n설치할 대상이 없습니다. Claude Code 또는 Codex를 먼저 설치해 주세요.");
    process.exitCode = 1;
    return;
  }

  const online = await checkHealth(config);
  if (!online) {
    console.log(
      `○ Pinglet 서버(${config.apiBaseUrl})에 연결할 수 없어 오프라인 모드로 설치합니다.`,
    );
    console.log("  서버 등록과 feed 수신은 온라인 상태가 되면 자동으로 재시도됩니다.");
  }

  const register = async (agentType: AgentType) => {
    if (config.installations[agentType] || !online) return;
    const record = await registerInstallation(config, agentType);
    if (record) {
      config.installations[agentType] = record;
      saveConfig(config);
    }
  };

  if (hasClaude) {
    await register("CLAUDE");
    let result = installClaudeIntegration(config, { force });
    if (!result.ok && result.needsForce) {
      const yes = await confirmReplace(
        "  기존 statusLine 설정이 있습니다. 백업 후 교체할까요? (uninstall 시 복원) (Y/n) ",
      );
      if (yes) result = installClaudeIntegration(config, { force: true });
    }
    console.log(
      result.ok
        ? "✓ Claude integration installed"
        : `✗ Claude integration skipped — ${result.reason}`,
    );
  }

  if (hasCodex) {
    await register("CODEX");
    let result = installCodexIntegration(config, { force });
    if (!result.ok && result.needsForce) {
      const yes = await confirmReplace(
        "  기존 notify 설정이 있습니다. 백업 후 교체할까요? (uninstall 시 복원) (Y/n) ",
      );
      if (yes) result = installCodexIntegration(config, { force: true });
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
      saveFeedMessages(messages);
      if (messages.length > 0) {
        console.log(`✓ Feed cached (${messages.length} messages)`);
        if (armSpinnerMessage(config, messages[0] ?? null)) {
          console.log("✓ Claude spinner synced");
        }
      }
    }
  }

  const targets = [hasClaude && "claude", hasCodex && "codex"]
    .filter(Boolean)
    .join(" 또는 ");
  console.log(`\n설치 완료! 평소처럼 ${targets}를 실행하면 Ping이 표시됩니다.`);
  console.log("  상태 확인:   pinglet doctor");
  console.log('  메시지 작성: pinglet login 후 pinglet post "메시지"');
  console.log("  계정 연결:   pinglet login  (메시지 작성/반응에 필요)");
}
