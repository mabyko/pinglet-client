import { spawn } from "child_process";
import { cliPath } from "./config";
import { feedAgeMs } from "./cache";
import { countEvents } from "./queue";
import { RuntimeState } from "./types";

export const ROTATE_MS = 60_000; // spinner 메시지 교체 주기 (설정 핫리로드로 즉시 반영)
export const QUALIFIED_MS = 3_000; // 유효 노출로 인정하는 최소 spinner 가동 시간
export const FLUSH_INTERVAL_MS = 60_000; // batch 전송 주기
export const FLUSH_COUNT = 20; // 또는 이벤트 개수 기준
export const FEED_TTL_MS = 5 * 60_000; // feed 캐시 갱신 주기

export function spawnDetachedCommand(args: string[]): void {
  try {
    const child = spawn(process.execPath, [cliPath(), ...args], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
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
  // 뒤 조건은 오프라인 시 재시도 폭주 방지용 스로틀 — TTL보다 짧아야 주기가 밀리지 않는다.
  const refreshDue =
    (age === null || age >= FEED_TTL_MS) &&
    (state.lastRefreshAt === undefined ||
      now - state.lastRefreshAt >= 2 * 60_000);
  if (refreshDue) {
    state.lastRefreshAt = now;
    spawnDetachedCommand(["refresh"]);
  }
}
