import { FeedMessage } from "./types";

/** 터미널 독립 원칙: unicode가 불확실하면 plain ASCII로 fallback (아키텍처 §5). */
export function supportsUnicode(): boolean {
  if (process.platform === "win32") return true; // Windows Terminal 기준
  const locale =
    process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  return /utf-?8/i.test(locale);
}

/**
 * 터미널에 그리기 전 최종 방어선: 제어·서식 문자를 제거한다.
 * 서버 moderation이 이미 거르지만, 구버전 서버·손상된 캐시를 신뢰하지 않는다
 * (ANSI escape가 살아 있으면 수신자 터미널을 조작할 수 있다).
 */
export function sanitizeForTerminal(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
}

/** 작성자 닉네임 없이 메시지만 표시한다 (spinner verb용). */
export function formatPing(message: FeedMessage): string {
  const sponsored = message.contentType === "SPONSORED" ? "[AD] " : "";
  const text = sanitizeForTerminal(message.text);
  if (supportsUnicode()) {
    return `💌 ${sponsored}"${text}"`;
  }
  return `[ping] ${sponsored}"${text}"`;
}

const REACH_TEXT_MAX = 24;

/** statusline용: 내가 쓴 최근 메시지의 도달 현황 한 줄 (커버리지 = 도달/활성 설치). */
export function formatMyReach(stats: {
  text: string;
  reachedInstallations: number;
  activeInstallations?: number;
}): string {
  let text = sanitizeForTerminal(stats.text);
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
