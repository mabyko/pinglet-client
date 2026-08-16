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

export async function runInstall(args: string[]): Promise<void> {
  const force = args.includes("--force");
  // --claude / --codex로 대상을 고를 수 있다. 둘 다 없으면 감지된 전부.
  const onlyClaude = args.includes("--claude");
  const onlyCodex = args.includes("--codex");
  const wantClaude = onlyClaude || !onlyCodex;
  const wantCodex = onlyCodex || !onlyClaude;
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
  console.log(hasCodex ? "✓ Codex detected" : "○ Codex not found");

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
    const result = installClaudeIntegration(config, { force });
    console.log(
      result.ok
        ? "✓ Claude integration installed"
        : `✗ Claude integration skipped — ${result.reason}`,
    );
  }

  if (hasCodex) {
    await register("CODEX");
    const result = installCodexIntegration(config, { force });
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

  console.log("\n설치 완료! 평소처럼 claude 또는 codex를 실행하면 Ping이 표시됩니다.");
  console.log("  상태 확인:   pinglet doctor");
  console.log('  메시지 작성: pinglet post "메시지"  (익명 — 바로 가능)');
  console.log("  계정 연결:   pinglet login  (선택 — 닉네임 표시/반응에 필요)");
}
