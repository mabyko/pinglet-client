import { FeedMessage } from "./types";

/** 터미널 독립 원칙: unicode가 불확실하면 plain ASCII로 fallback (아키텍처 §5). */
export function supportsUnicode(): boolean {
  if (process.platform === "win32") return true; // Windows Terminal 기준
  const locale =
    process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  return /utf-?8/i.test(locale);
}

/** 작성자 닉네임 없이 메시지만 표시한다 (spinner verb용). */
export function formatPing(message: FeedMessage): string {
  const sponsored = message.contentType === "SPONSORED" ? "[AD] " : "";
  if (supportsUnicode()) {
    return `💌 ${sponsored}"${message.text}"`;
  }
  return `[ping] ${sponsored}"${message.text}"`;
}

const REACH_TEXT_MAX = 24;

/** statusline용: 내가 쓴 최근 메시지의 도달 현황 한 줄. */
export function formatMyReach(stats: {
  text: string;
  reachedInstallations: number;
}): string {
  let text = stats.text;
  if (text.length > REACH_TEXT_MAX) text = text.slice(0, REACH_TEXT_MAX - 1) + "…";
  if (supportsUnicode()) {
    return `💌 내 Ping "${text}" → 터미널 ${stats.reachedInstallations}곳 도달`;
  }
  return `[ping] "${text}" -> reached ${stats.reachedInstallations} terminals`;
}
