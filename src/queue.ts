import * as fs from "fs";
import { randomUUID } from "crypto";
import { EVENTS_PATH, ensurePingletDir } from "./config";
import { AgentType, EventType, QueuedEvent } from "./types";
import { atomicWrite } from "./storage";

/**
 * Local Event Queue (JSONL). All CLI writers hold withPingletLock for the
 * complete command, so append and removal cannot interleave across processes.
 * 노출 즉시 서버를 호출하지 않고 여기 기록했다가 batch 전송한다 (아키텍처 §8).
 */
export function appendEvent(input: {
  agentType: AgentType;
  type: EventType;
  messageId: string;
  visibleMs?: number;
}): void {
  ensurePingletDir();
  const event: QueuedEvent = {
    eventId: "evt_" + randomUUID(),
    agentType: input.agentType,
    type: input.type,
    messageId: input.messageId,
    ...(input.visibleMs !== undefined && { visibleMs: input.visibleMs }),
    occurredAt: new Date().toISOString(),
  };
  fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + "\n");
}

export function readEvents(): QueuedEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(EVENTS_PATH, "utf8");
  } catch {
    return [];
  }
  const events: QueuedEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as QueuedEvent;
      if (parsed.eventId && parsed.messageId && parsed.type) {
        events.push(parsed);
      }
    } catch {
      // 손상된 라인은 버린다.
    }
  }
  return events;
}

export function countEvents(): number {
  return readEvents().length;
}

/** 전송에 성공한 이벤트만 제거하고, 그 사이에 append된 이벤트는 보존한다. */
export function removeEvents(sentEventIds: Set<string>): void {
  const remaining = readEvents().filter((e) => !sentEventIds.has(e.eventId));
  const body = remaining.map((e) => JSON.stringify(e)).join("\n");
  atomicWrite(EVENTS_PATH, body ? body + "\n" : "");
}
