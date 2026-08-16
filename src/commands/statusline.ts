import * as fs from "fs";
import { loadConfig } from "../config";
import {
  loadFeedMessages,
  loadMyStats,
  loadState,
  saveState,
} from "../cache";
import { formatMyReach } from "../render";
import { pickMessage } from "../picker";
import { appendEvent } from "../queue";
import { armSpinnerMessage } from "../adapters/claude";
import { QUALIFIED_MS, ROTATE_MS, runMaintenance } from "../runtime";
import { RuntimeState } from "../types";

interface StatuslinePayload {
  session_id?: string;
  cost?: { total_api_duration_ms?: number };
}

function readPayload(): StatuslinePayload {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")) as StatuslinePayload;
  } catch {
    return {};
  }
}

/**
 * cost.total_api_duration_ms 증가분 = 이 tick 사이에 spinner가 실제로 돈 시간.
 * spinner pool이 1개이므로 그 시간만큼 armed 메시지가 화면에 표시된 것이 확정된다.
 */
function trackSpinnerActivity(
  state: RuntimeState,
  payload: StatuslinePayload,
): void {
  const sessionId = payload.session_id;
  const apiMs = payload.cost?.total_api_duration_ms;
  if (!sessionId || typeof apiMs !== "number") return;

  state.sessions ??= {};
  const prev = state.sessions[sessionId];
  state.sessions[sessionId] = apiMs;

  // 오래된 세션 기록이 무한히 쌓이지 않게 상한을 둔다.
  const ids = Object.keys(state.sessions);
  if (ids.length > 20) delete state.sessions[ids[0]];

  if (prev === undefined || apiMs <= prev || !state.current) return;
  state.current.visibleMs = Math.min(
    (state.current.visibleMs ?? 0) + (apiMs - prev),
    ROTATE_MS,
  );
}

/**
 * 이전 armed 메시지의 노출을 정산하고 다음 메시지를 armed한다.
 * QUALIFIED_MS 이상 spinner가 돌았으면 유효 노출(visibleMs 포함)로 기록한다.
 */
function rotateSpinner(state: RuntimeState, now: number): void {
  const config = loadConfig();
  const prev = state.current;
  if (prev && (prev.visibleMs ?? 0) >= QUALIFIED_MS) {
    appendEvent({
      agentType: "CLAUDE",
      type: "QUALIFIED_IMPRESSION",
      messageId: prev.messageId,
      visibleMs: prev.visibleMs,
    });
  }

  const message = pickMessage(loadFeedMessages(), state);
  if (!message) {
    armSpinnerMessage(config, null);
    state.current = undefined;
    return;
  }

  armSpinnerMessage(config, message);
  state.seen[message.id] = (state.seen[message.id] ?? 0) + 1;
  state.delivered ??= {};
  if (!state.delivered[message.id]) {
    appendEvent({
      agentType: "CLAUDE",
      type: "DELIVERED",
      messageId: message.id,
    });
    state.delivered[message.id] = 1;
  }
  state.current = {
    messageId: message.id,
    text: message.text,
    author: message.author,
    shownAt: now,
    visibleMs: 0,
  };
}

/**
 * Claude Code statusLine hook 진입점.
 * - spinner 회전(pool=1): ROTATE_MS마다 다음 메시지를 armed (설정 핫리로드로 즉시 반영)
 * - 노출 측정: stdin payload의 cost 델타로 armed 메시지의 실제 표시 시간을 누적
 * - statusline 표시: 이 기기에서 작성한 최근 메시지의 도달 현황
 * - flush/refresh 백그라운드 트리거 (Claude 사용 중 항상 호출되므로 이 경로에서)
 */
export function runStatusline(): void {
  const payload = readPayload();
  const state = loadState();
  const now = Date.now();

  trackSpinnerActivity(state, payload);

  const rotateDue = !state.current || now - state.current.shownAt >= ROTATE_MS;
  // 300ms마다 호출되므로 저장/maintenance는 1초 스로틀. 회전 시점에는 항상 저장.
  const saveDue =
    rotateDue ||
    state.lastTickAt === undefined ||
    now - state.lastTickAt > 1_000;

  if (rotateDue) {
    rotateSpinner(state, now);
  }
  if (saveDue) {
    runMaintenance(state, now);
    state.lastTickAt = now;
    saveState(state);
  }

  const stats = loadMyStats();
  process.stdout.write(stats ? formatMyReach(stats) : "");
}
