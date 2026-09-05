import { CONFIG_PATH, loadConfig } from "../config";
import * as fs from "fs";
import { MAX_BATCH_SIZE, uploadEventBatchResult } from "../api";
import { bindEvents, invalidEventReason, quarantineEvents, removeEvents } from "../queue";
import { AgentType, QueuedEvent, InstallRecord } from "../types";
import { withPingletLock } from "../lock";

/**
 * Local Event Queue를 batch로 서버에 전송한다 (아키텍처 §8).
 * 전송 성공한 이벤트만 큐에서 제거하므로 실패분은 다음 주기에 재시도되고,
 * 재전송 중복은 서버가 eventId로 dedupe한다.
 */
export async function runFlush(): Promise<void> {
  const snapshot = await withPingletLock(() => {
    if (!fs.existsSync(CONFIG_PATH)) return;
    const config = loadConfig();
    const events = bindEvents();
    const valid: QueuedEvent[] = [];
    for (const event of events) {
      const reason = invalidEventReason(event);
      const record = config.installations[event.agentType];
      if (reason) quarantineEvents([event], reason);
      else if (event.installationId && event.installationId !== record?.installationId) quarantineEvents([event], "retired-installation");
      else valid.push(event);
    }
    return { config, events: valid };
  });
  if (!snapshot) return;
  const { config, events } = snapshot;
  const send = async (record: InstallRecord, chunk: QueuedEvent[]): Promise<boolean> => {
    const result = await uploadEventBatchResult(config, record, chunk);
    if (result.ok) {
      await withPingletLock(() => removeEvents(new Set(chunk.map(event => event.eventId))));
      return true;
    }
    if (!result.permanent) return false;
    if (chunk.length === 1) {
      await withPingletLock(() => quarantineEvents(chunk, `http-${result.status}`));
      return true;
    }
    const middle = Math.floor(chunk.length / 2);
    return await send(record, chunk.slice(0, middle)) && await send(record, chunk.slice(middle));
  };

  for (const agentType of ["CLAUDE", "CODEX"] as AgentType[]) {
    const record = config.installations[agentType];
    const group = events.filter((e) => e.agentType === agentType);
    if (group.length === 0) continue;
    if (!record) continue; // 미등록 상태 — refresh가 등록을 재시도한다.

    for (let i = 0; i < group.length; i += MAX_BATCH_SIZE) {
      const chunk = group.slice(i, i + MAX_BATCH_SIZE);
      if (!await send(record, chunk)) break;
    }
  }
}
