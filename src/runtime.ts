import { spawn } from "child_process";
import { cliPath } from "./config";
import { feedAgeMs, loadFeedMessages } from "./cache";
import { pickMessage } from "./picker";
import { appendEvent, countEvents } from "./queue";
import { AgentType, FeedMessage, RuntimeState } from "./types";

export const ROTATE_MS = 30_000; // 메시지 교체 주기
export const QUALIFIED_MS = 3_000; // 정책상 최소 노출 시간 (아키텍처 §7.2)
export const FLUSH_INTERVAL_MS = 60_000; // batch 전송 주기
export const FLUSH_COUNT = 20; // 또는 이벤트 개수 기준
export const FEED_TTL_MS = 30 * 60_000; // feed 캐시 갱신 주기

/** 구버전 시드 메시지 id는 서버에 존재하지 않으므로 이벤트를 만들지 않는다. */
function isServerMessage(messageId: string): boolean {
  return !messageId.startsWith("seed_");
}

/**
 * 이전 메시지의 QUALIFIED_IMPRESSION을 정산하고 다음 메시지를 뽑는다.
 * 렌더링 path이므로 네트워크 호출 없이 로컬 캐시만 읽는다 (Local-first).
 * feed가 비어 있으면 null — 호출부는 아무것도 표시하지 않는다.
 */
export function rotateMessage(
  state: RuntimeState,
  agentType: AgentType,
  now: number,
): FeedMessage | null {
  const prev = state.current;
  if (prev && isServerMessage(prev.messageId)) {
    // 세션이 중간에 끊겼으면 마지막 tick까지만 보였다고 간주한다.
    const sessionGap =
      state.lastTickAt !== undefined && now - state.lastTickAt > ROTATE_MS * 2;
    const visibleEnd = sessionGap ? state.lastTickAt! : now;
    const visibleMs = Math.max(0, Math.min(visibleEnd - prev.shownAt, ROTATE_MS));
    if (visibleMs >= QUALIFIED_MS) {
      appendEvent({
        agentType,
        type: "QUALIFIED_IMPRESSION",
        messageId: prev.messageId,
        visibleMs,
      });
    }
  }

  const message = pickMessage(loadFeedMessages(), state);
  if (!message) {
    delete state.current;
    return null;
  }
  if (isServerMessage(message.id)) {
    appendEvent({ agentType, type: "DELIVERED", messageId: message.id });
  }
  state.seen[message.id] = (state.seen[message.id] ?? 0) + 1;
  state.current = {
    messageId: message.id,
    text: message.text,
    author: message.author,
    shownAt: now,
  };
  return message;
}

function spawnDetachedCommand(args: string[]): void {
  try {
    const child = spawn(process.execPath, [cliPath(), ...args], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // 백그라운드 작업 실패는 렌더링에 영향을 주면 안 된다.
  }
}

/**
 * flush/refresh가 필요하면 detached 프로세스로 넘긴다.
 * 렌더링 프로세스는 절대 네트워크를 기다리지 않는다 (Async Telemetry).
 */
export function runMaintenance(state: RuntimeState, now: number): void {
  const queued = countEvents();
  const flushDue =
    queued >= FLUSH_COUNT ||
    (queued > 0 &&
      (state.lastFlushAt === undefined ||
        now - state.lastFlushAt >= FLUSH_INTERVAL_MS));
  if (flushDue) {
    state.lastFlushAt = now; // spawn 시점 기록 — 실패해도 다음 주기에 재시도
    spawnDetachedCommand(["flush"]);
  }

  const age = feedAgeMs();
  const refreshDue =
    (age === null || age >= FEED_TTL_MS) &&
    (state.lastRefreshAt === undefined ||
      now - state.lastRefreshAt >= 5 * 60_000);
  if (refreshDue) {
    state.lastRefreshAt = now;
    spawnDetachedCommand(["refresh"]);
  }
}
