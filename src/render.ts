import { FeedMessage } from "./types";

export type DisplayLocale = "ko" | "ja" | "en";

/**
 * statusline 표시 언어. 시스템 언어를 먼저 보고(사용자가 실제로 읽는
 * 언어라 가장 강한 신호), 언어로 판정이 안 되면 타임존을 위치의 근사로
 * 쓴다. 한국·일본은 둘 다 UTC+9라 타임존만으로는 오판하는 기기가 있다
 * (예: 한국에서 Asia/Tokyo 타임존을 쓰는 기기 — 시계가 맞아서 티가 안 남).
 * 네트워크 없이 판정한다 (오프라인 동작 원칙).
 */
export function detectLocale(): DisplayLocale {
  const lang = (
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    ""
  ).toLowerCase();
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("ja")) return "ja";
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (tz === "Asia/Seoul") return "ko";
    if (tz === "Asia/Tokyo") return "ja";
  } catch {
    // Intl이 없는 환경 — 영어로.
  }
  return "en";
}

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

/** statusline용: 지금 함께 켜져 있는 다른 터미널 수 한 줄. */
export function formatOnlineNow(othersCount: number): string {
  const n = othersCount;
  // 한국어·일본어는 unicode 전제 — 못 그리는 터미널이면 ASCII 영어로.
  if (!supportsUnicode()) {
    return `[ping] coding along with ${n} ${n === 1 ? "terminal" : "terminals"} now`;
  }
  switch (detectLocale()) {
    case "ko":
      return `🟢 지금 ${n}개 터미널과 함께 코딩 중`;
    case "ja":
      return `🟢 いま${n}個のターミナルと一緒にコーディング中`;
    default:
      return `🟢 coding along with ${n} ${n === 1 ? "terminal" : "terminals"} right now`;
  }
}
