import { loadConfig, saveConfig } from "../config";
import { fetchFeed, registerInstallation, sendHeartbeat } from "../api";
import { saveFeedMessages } from "../cache";
import { syncSpinnerVerbs } from "../adapters/claude";
import { AgentType } from "../types";

/**
 * 서버 feed를 미리 받아 Local Feed Cache를 갱신한다 (아키텍처 §6).
 * 설치 당시 오프라인이었다면 installation 등록도 여기서 재시도한다.
 */
export async function runRefresh(): Promise<void> {
  const config = loadConfig();

  const wanted: AgentType[] = [];
  if (config.adapters.claude) wanted.push("CLAUDE");
  if (config.adapters.codex) wanted.push("CODEX");

  for (const agentType of wanted) {
    if (!config.installations[agentType]) {
      const record = await registerInstallation(config, agentType);
      if (record) {
        config.installations[agentType] = record;
        saveConfig(config);
      }
    }
  }

  const records = Object.values(config.installations);
  if (records.length === 0) return;

  await Promise.all(records.map((r) => sendHeartbeat(config, r)));

  const messages = await fetchFeed(config, records[0]);
  if (messages) {
    saveFeedMessages(messages);
    // 새 feed를 Claude Code spinner verb에도 반영한다 (설정 파일만 다시 쓰면 됨).
    // feed가 비었으면 spinner를 기본 상태로 되돌린다.
    syncSpinnerVerbs(config, messages);
  }
}
