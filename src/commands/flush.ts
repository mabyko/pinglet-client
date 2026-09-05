import { CONFIG_PATH, loadConfig } from "../config";
import * as fs from "fs";
import { MAX_BATCH_SIZE, uploadEventBatch } from "../api";
import { readEvents, removeEvents } from "../queue";
import { AgentType } from "../types";

/**
 * Local Event Queue를 batch로 서버에 전송한다 (아키텍처 §8).
 * 전송 성공한 이벤트만 큐에서 제거하므로 실패분은 다음 주기에 재시도되고,
 * 재전송 중복은 서버가 eventId로 dedupe한다.
 */
export async function runFlush(): Promise<void> {
  if (!fs.existsSync(CONFIG_PATH)) return;
  const config = loadConfig();
  const events = readEvents();
  if (events.length === 0) return;

  for (const agentType of ["CLAUDE", "CODEX"] as AgentType[]) {
    const record = config.installations[agentType];
    const group = events.filter((e) => e.agentType === agentType);
    if (group.length === 0) continue;
    if (!record) continue; // 미등록 상태 — refresh가 등록을 재시도한다.

    for (let i = 0; i < group.length; i += MAX_BATCH_SIZE) {
      const chunk = group.slice(i, i + MAX_BATCH_SIZE);
      const ok = await uploadEventBatch(config, record, chunk);
      if (!ok) break;
      removeEvents(new Set(chunk.map((e) => e.eventId)));
    }
  }
}
