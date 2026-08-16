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

/** statusline용: 내가 쓴 최근 메시지의 도달 현황 한 줄 (커버리지 = 도달/활성 설치). */
export function formatMyReach(stats: {
  text: string;
  reachedInstallations: number;
  activeInstallations?: number;
}): string {
  let text = stats.text;
  if (text.length > REACH_TEXT_MAX) text = text.slice(0, REACH_TEXT_MAX - 1) + "…";
  const reached = stats.reachedInstallations;
  const active = stats.activeInstallations ?? 0;
  // 활성 설치 수를 모르면(구서버/구캐시) 도달 수만 표시한다.
  const coverage =
    active > 0
      ? `도달률 ${Math.round((reached / active) * 100)}%`
      : `터미널 ${reached}곳 도달`;
  if (supportsUnicode()) {
    return `💌 내 Ping "${text}" → ${coverage}`;
  }
  const asciiCoverage =
    active > 0
      ? `reach ${Math.round((reached / active) * 100)}%`
      : `reached ${reached} terminals`;
  return `[ping] "${text}" -> ${asciiCoverage}`;
}
