import { loadConfig, saveConfig } from "../config";
import {
  fetchFeed,
  fetchMessageStats,
  registerInstallation,
  sendHeartbeat,
} from "../api";
import {
  loadMyPosts,
  loadState,
  saveFeedMessages,
  saveMyStats,
  saveState,
} from "../cache";
import { appendEvent } from "../queue";
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

    // spinner는 실제 노출 시점을 알 수 없으므로, spinner pool에 실린 시점을
    // "전달(DELIVERED)"로 기록한다. 메시지당 설치 1회만.
    if (config.adapters.claude && config.installations.CLAUDE) {
      const state = loadState();
      state.delivered ??= {};
      let changed = false;
      for (const m of messages) {
        if (state.delivered[m.id]) continue;
        appendEvent({ agentType: "CLAUDE", type: "DELIVERED", messageId: m.id });
        state.delivered[m.id] = 1;
        changed = true;
      }
      if (changed) saveState(state);
    }
  }

  // 이 기기에서 작성한 최근 메시지의 도달 통계를 갱신한다 (statusline 표시용).
  const latest = loadMyPosts()[0];
  if (latest) {
    const stats = await fetchMessageStats(config, latest.id);
    if (stats) {
      saveMyStats({
        messageId: latest.id,
        text: latest.text,
        reachedInstallations: stats.reachedInstallations,
        delivered: stats.delivered,
        qualifiedImpressions: stats.qualifiedImpressions,
        reactions: stats.reactions,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
