import * as fs from "fs";
import { randomUUID, createHash } from "crypto";
import { EVENTS_PATH, PINGLET_DIR, loadConfig, ensurePingletDir } from "./config";
import * as path from "path";
import { AgentType, EventType, QueuedEvent } from "./types";
import { atomicWrite } from "./storage";

/**
 * Local Event Queue (JSONL). Writers hold the short local transaction lock;
 * uploads use a snapshot and acknowledge only its event IDs afterwards.
 * 노출 즉시 서버를 호출하지 않고 여기 기록했다가 batch 전송한다 (아키텍처 §8).
 */
export function appendEvent(input: {
  eventId?: string;
  agentType: AgentType;
  type: EventType;
  messageId: string;
  visibleMs?: number;
}): void {
  ensurePingletDir();
  const event: QueuedEvent = {
    eventId: input.eventId ?? "evt_" + randomUUID(),
    agentType: input.agentType,
    installationId: loadConfig().installations[input.agentType]?.installationId,
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
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.eventId !== "string" || !parsed.eventId) throw new Error("invalid queue record");
      events.push(parsed);
    } catch {
      // Preserve damaged input for quarantine rather than silently deleting it
      // when the next successful upload rewrites the queue.
      events.push({ eventId: "invalid_" + createHash("sha256").update(line).digest("hex").slice(0, 48),
        agentType: "CLAUDE", type: "DELIVERED", messageId: "", occurredAt: "",
        queueError: "malformed-queue-line", rawLine: line });
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

/** Persist before removing from the retry queue. No tokens or server writes. */
export function quarantineEvents(events: QueuedEvent[], reason: string): void {
  if (!events.length) return;
  ensurePingletDir();
  fs.appendFileSync(path.join(PINGLET_DIR, "events-quarantine.jsonl"),
    events.map(event => JSON.stringify({ reason, quarantinedAt: new Date().toISOString(), event })).join("\n") + "\n",
    { mode: 0o600 });
  removeEvents(new Set(events.map(event => event.eventId)));
}

/** Legacy/offline events bind once, before any installation can be revoked. */
export function bindEvents(): QueuedEvent[] {
  const config = loadConfig();
  const events = readEvents();
  let changed = false;
  for (const event of events) {
    if (!event.installationId && config.installations[event.agentType]) {
      event.installationId = config.installations[event.agentType]!.installationId;
      changed = true;
    }
  }
  if (changed) atomicWrite(EVENTS_PATH, events.map(event => JSON.stringify(event)).join("\n") + "\n");
  return events;
}

export function invalidEventReason(event: QueuedEvent): string | null {
  if (event.queueError) return event.queueError;
  if (!["CLAUDE", "CODEX"].includes(event.agentType) ||
      !["DELIVERED", "QUALIFIED_IMPRESSION"].includes(event.type)) return "invalid-type";
  if ([event.eventId, event.messageId].some(value => typeof value !== "string" || !value.length || value.length > 64)) return "invalid-id";
  if (event.visibleMs != null && (!Number.isInteger(event.visibleMs) || event.visibleMs < 0 || event.visibleMs > 60_000)) return "invalid-visible-ms";
  const time = typeof event.occurredAt === "string" ? Date.parse(event.occurredAt) : NaN;
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1) || time > Date.now() + 5 * 60_000) return "invalid-timestamp";
  return null;
}
