import { loadMyStats, loadState, saveState } from "../cache";
import { formatMyReach } from "../render";
import { runMaintenance } from "../runtime";

/**
 * Claude Code statusLine hook 진입점.
 * Ping 메시지는 spinner(spinnerVerbs)가 담당하고, statusline에는
 * 이 기기에서 작성한 최근 메시지의 도달 현황을 보여준다.
 * flush/refresh 백그라운드 트리거도 이 경로에서 돈다 (Claude 사용 중 항상 호출되므로).
 */
export function runStatusline(): void {
  const state = loadState();
  const now = Date.now();

  // 300ms마다 호출되므로 상태 기록/maintenance는 1초 스로틀.
  if (state.lastTickAt === undefined || now - state.lastTickAt > 1_000) {
    runMaintenance(state, now);
    state.lastTickAt = now;
    saveState(state);
  }

  const stats = loadMyStats();
  process.stdout.write(stats ? formatMyReach(stats) : "");
}
