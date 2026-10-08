import * as fs from "fs";
import { CONFIG_PATH, loadConfig } from "../config";
import {
  loadFeedMessages,
  loadState,
  saveState,
} from "../cache";
import { formatNewsLink } from "../render";
import { pickMessage } from "../picker";
import { appendEvent } from "../queue";
import { armSpinnerMessage } from "../adapters/claude";
import { QUALIFIED_MS, ROTATE_MS, runMaintenance } from "../runtime";
import { RuntimeState } from "../types";
import { isTurnInProgress, TURN_STALE_MS } from "../turn";
import { HudConfig, loadHudConfig, renderHudLines } from "../hud";
import { StatuslinePayload } from "../hud/stdin";

/** 잠금 안에서 끝낸 tick의 결과 — 잠금을 놓은 뒤 HUD를 그려 출력한다. */
export interface StatuslineTick {
  payload: StatuslinePayload;
  /** HUD 위에 먼저 나올 줄 (지금 spinner에 armed된 뉴스 링크). */
  lines: string[];
  hud: HudConfig;
}

function readPayload(): StatuslinePayload {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(0, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StatuslinePayload) : {};
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
 * spinner는 시작할 때 고른 문구를 턴 끝까지 유지한다. spinnerVerbs는 모든 세션이
 * 공유하므로, 어느 세션이든 턴이 진행 중이면 회전을 미뤄 spinner와 statusline을 맞춘다.
 * 세션이 턴 도중 닫혀도 TURN_STALE_MS 뒤에는 기록이 풀린다.
 */
function updateBusySessions(state: RuntimeState, payload: StatuslinePayload, now: number): boolean {
  const busy = state.busySessions ?? {};
  const sessionId = payload.session_id;
  if (sessionId) {
    if (isTurnInProgress(payload.transcript_path, now)) busy[sessionId] = now;
    else delete busy[sessionId];
  }
  for (const [id, seenAt] of Object.entries(busy)) {
    if (now - seenAt > TURN_STALE_MS) delete busy[id];
  }
  state.busySessions = Object.keys(busy).length > 0 ? busy : undefined;
  return state.busySessions !== undefined;
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
    prev.visibleMs = 0; // A failed replacement must not account this interval twice.
    // The event is already on disk. Persist the reset now: if arming below throws
    // (e.g. settings.json is temporarily unparseable) the tick ends before the
    // final saveState and the next tick would settle the same interval again.
    saveState(state);
  }

  const message = pickMessage(loadFeedMessages(), state);
  if (!message) {
    armSpinnerMessage(config, null);
    state.current = undefined;
    return;
  }

  if (!armSpinnerMessage(config, message)) {
    // No delivery/current transition until the settings write actually commits.
    // Clear attribution of subsequent API time and retry on the next tick.
    state.current = undefined;
    return;
  }
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
    url: message.url ?? null,
    shownAt: now,
    visibleMs: 0,
  };
}

/**
 * Claude Code statusLine hook 진입점 (로컬 잠금 안, 동기).
 * - spinner 회전(pool=1): ROTATE_MS마다 다음 메시지를 armed (설정 핫리로드로 즉시 반영)
 * - 노출 측정: stdin payload의 cost 델타로 armed 메시지의 실제 표시 시간을 누적
 * - flush/refresh 백그라운드 트리거 (Claude 사용 중 항상 호출되므로 이 경로에서)
 * 출력할 줄과 payload를 돌려주면 호출부가 잠금을 놓고 `writeStatusline`으로 HUD까지 그린다.
 */
export function runStatusline(): StatuslineTick | undefined {
  if (!fs.existsSync(CONFIG_PATH)) return undefined;
  const config = loadConfig();
  if (!config.adapters.claude) return undefined;
  const payload = readPayload();
  const state = loadState();
  const now = Date.now();

  trackSpinnerActivity(state, payload);

  const turnBusy = updateBusySessions(state, payload, now);
  // 피드에서 빠진(삭제·만료) 항목은 턴 중이라도 바로 내린다.
  const rotateDue = !state.current ||
    !loadFeedMessages().some((message) => message.id === state.current?.messageId) ||
    (!turnBusy && now - state.current.shownAt >= ROTATE_MS);
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

  const lines: string[] = [];
  // spinner와 같은 항목을 링크로 보여준다. HUD 세그먼트 폭 계산(hud/width)은
  // OSC 8을 모르므로 HUD 안이 아니라 별도 줄로 둔다.
  if (state.current?.url) lines.push(formatNewsLink(state.current.text, state.current.url));
  return { payload, lines, hud: loadHudConfig(config) };
}

/**
 * 잠금 밖에서 HUD(모델·컨텍스트·사용량·활동)를 그려 뉴스 링크 줄 아래에 출력한다.
 * HUD는 실패해도 위 줄에 영향을 주면 안 된다.
 */
export async function writeStatusline(
  tick: StatuslineTick,
  now = Date.now(),
  write: (text: string) => void = (text) => { process.stdout.write(text); },
): Promise<void> {
  const lines = [...tick.lines];
  try {
    lines.push(...(await renderHudLines(tick.hud, tick.payload, now)));
  } catch {
    // 손상된 transcript·git 오류 등 — 이번 tick은 HUD 없이 그린다.
  }
  write(lines.join("\n"));
}
