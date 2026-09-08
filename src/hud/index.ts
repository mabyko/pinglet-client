import { PingletConfig } from "../config";
import { HudConfig, normalizeHudConfig } from "./config";
import { getGitStatus } from "./git";
import { getMemoryUsage } from "./memory";
import { renderHud } from "./render";
import { getOutputSpeed } from "./speed";
import { StatuslinePayload } from "./stdin";
import { TranscriptData, parseTranscript } from "./transcript";

export { HudConfig } from "./config";
export { StatuslinePayload } from "./stdin";

/** config.json의 `hud` 섹션을 정규화해 돌려준다 (없으면 기본값 = full 프리셋). */
export function loadHudConfig(config: Pick<PingletConfig, "hud">): HudConfig {
  return normalizeHudConfig(config.hud);
}

/**
 * statusline tick에서 호출 — payload가 없으면(수동 실행 등) HUD 줄을 그리지 않는다.
 * transcript는 비동기 스트림으로, git은 비동기 서브프로세스로 읽으며 네트워크는 쓰지 않는다.
 * 로컬 잠금 밖에서 실행되므로 다른 훅을 막지 않는다.
 */
export async function renderHudLines(
  hud: HudConfig,
  payload: StatuslinePayload,
  now = Date.now(),
): Promise<string[]> {
  if (!hud.enabled) return [];
  const hasPayload = !!(payload.model || payload.context_window || payload.cwd || payload.transcript_path);
  if (!hasPayload) return [];

  const { display, gitStatus } = hud;
  const needsTranscript = display.showTools || display.showSkills || display.showAgents || display.showTodos ||
    display.showSessionName || display.showDuration || display.showPromptCache || display.showAdvisor ||
    display.showSessionTokens || display.showCompactions || display.showEffortLevel;
  const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : undefined;
  const cwd = typeof payload.cwd === "string" ? payload.cwd : payload.workspace?.current_dir;

  const [transcript, git] = await Promise.all([
    needsTranscript ? parseTranscript(transcriptPath) : Promise.resolve<TranscriptData>({ tools: [], agents: [], todos: [], skills: [] }),
    gitStatus.enabled ? getGitStatus(cwd) : Promise.resolve(null),
  ]);
  const memory = display.showMemoryUsage && hud.lineLayout === "expanded" && hud.elementOrder.includes("memory")
    ? getMemoryUsage(now)
    : null;
  const speed = display.showSpeed ? getOutputSpeed(payload, now) : null;

  return renderHud({ config: hud, payload, transcript, gitStatus: git, memory, speed, now });
}
