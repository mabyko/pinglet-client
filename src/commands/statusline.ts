import { loadState, saveState } from "../cache";
import { formatPing } from "../render";
import { ROTATE_MS, rotateMessage, runMaintenance } from "../runtime";

/**
 * Claude Code statusLine hook 진입점.
 * Claude Code가 상태 변경마다(최대 300ms 간격) 호출하며, stdout 한 줄이 status 영역에 그려진다.
 * 이 경로는 반드시 빨라야 하므로 로컬 파일만 읽고, 네트워크 작업은 detached로 넘긴다.
 */
export function runStatusline(): void {
  const state = loadState();
  const now = Date.now();
  const current = state.current;

  let line: string;
  if (!current || now - current.shownAt >= ROTATE_MS) {
    const message = rotateMessage(state, "CLAUDE", now);
    line = formatPing(message);
    runMaintenance(state, now);
    state.lastTickAt = now;
    saveState(state);
  } else {
    line = formatPing({
      id: current.messageId,
      text: current.text,
      author: current.author,
      contentType: "USER",
    });
    // visibleMs 추정용 tick. 300ms마다 쓰지 않도록 1초 스로틀.
    if (state.lastTickAt === undefined || now - state.lastTickAt > 1_000) {
      state.lastTickAt = now;
      saveState(state);
    }
  }

  process.stdout.write(line);
}
