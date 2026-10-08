import * as fs from "fs";

/** transcript 끝에서 읽는 양 — 마지막 몇 줄만 보면 된다. 큰 tool_result 한 줄보다는 넉넉하게. */
const TAIL_BYTES = 256 * 1024;
/**
 * transcript가 이만큼 조용하면 진행 중으로 보지 않는다. 비정상 종료·로컬 명령처럼
 * 응답이 기록되지 않는 경우 회전이 영원히 멈추지 않게 하는 상한.
 */
export const TURN_STALE_MS = 10 * 60_000;

interface TranscriptEntry {
  type?: string;
  subtype?: string;
  message?: { stop_reason?: string | null; content?: unknown };
}

function isInterrupt(entry: TranscriptEntry): boolean {
  const content = entry.message?.content;
  const texts = typeof content === "string" ? [content]
    : Array.isArray(content) ? content.map((part) => (part as { text?: unknown })?.text).filter((t): t is string => typeof t === "string")
    : [];
  return texts.some((text) => text.startsWith("[Request interrupted"));
}

/**
 * 이 세션의 턴이 진행 중인지(= spinner가 돌고 있는지) transcript 꼬리로 판단한다.
 * Claude Code는 spinner가 시작될 때 고른 문구를 턴이 끝날 때까지 유지하므로,
 * 진행 중에 spinnerVerbs를 바꾸면 spinner와 statusline이 서로 다른 항목을 보여준다.
 * 판단할 수 없으면 false — 예전처럼 회전한다.
 */
export function isTurnInProgress(transcriptPath: string | undefined, now: number): boolean {
  if (!transcriptPath) return false;
  let fd: number | undefined;
  try {
    const stat = fs.statSync(transcriptPath);
    if (now - stat.mtimeMs > TURN_STALE_MS) return false;
    const length = Math.min(stat.size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(transcriptPath, "r");
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    const lines = buffer.toString("utf8").split("\n");
    if (length < stat.size) lines.shift(); // 잘린 첫 줄
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: TranscriptEntry;
      try { entry = JSON.parse(lines[i]) as TranscriptEntry; } catch { continue; }
      if (entry.type === "system" && entry.subtype === "turn_duration") return false;
      if (entry.type === "assistant") {
        const stop = entry.message?.stop_reason;
        return stop === "tool_use" || stop == null;
      }
      if (entry.type === "user") return !isInterrupt(entry);
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
