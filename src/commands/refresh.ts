import { loadConfig, saveConfig } from "../config";
import { fetchFeed, registerInstallation, sendHeartbeat } from "../api";
import {
  loadState,
  saveFeedMessages,
  saveOnline,
  saveState,
} from "../cache";
import { armSpinnerMessage } from "../adapters/claude";
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

  const onlineCounts = await Promise.all(
    records.map((r) => sendHeartbeat(config, r)),
  );
  const online = onlineCounts.find((n): n is number => n !== null);
  if (online !== undefined) {
    saveOnline(online);
  }

  const messages = await fetchFeed(config, records[0]);
  if (messages) {
    saveFeedMessages(messages);
    // spinner 회전과 DELIVERED/QUALIFIED 기록은 statusline이 담당한다 (pool=1).
    // 여기서는 armed된 메시지가 서버에서 사라진 경우만 즉시 정리한다.
    const state = loadState();
    const current = state.current;
    if (current && !messages.some((m) => m.id === current.messageId)) {
      armSpinnerMessage(config, messages[0] ?? null);
      state.current = undefined; // 다음 statusline tick이 정식으로 다음 메시지를 armed한다
      saveState(state);
    }
  }
}
