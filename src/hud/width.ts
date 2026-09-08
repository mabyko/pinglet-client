/**
 * 터미널 셀 폭 계산과 폭 맞춤 — claude-hud와 같은 규칙.
 *   - SGR(색)과 OSC 8(하이퍼링크) escape는 폭 0
 *   - 한중일 문자·이모지는 2칸
 *   - 폭을 넘는 줄은 구분자(" | ", " │ ")에서 감고, 그래도 넘치면 말줄임표로 자른다
 * statusline이 터미널 폭을 넘으면 Claude Code가 줄을 감아 HUD 줄 수가 흔들리므로
 * 렌더러가 먼저 폭에 맞춘다.
 */

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /^(?:\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_GLOBAL = /(?:\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
// eslint-disable-next-line no-control-regex
const OSC8_OPEN_OR_CLOSE = /\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC8_CLOSE = "\x1b]8;;\x1b\\";
const RESET = "\x1b[0m";

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_GLOBAL, "");
}

function codePointWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0; // combining
  if (cp === 0x200b || cp === 0x200d || cp === 0xfe0e || cp === 0xfe0f) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function visualWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += codePointWidth(ch.codePointAt(0) ?? 0);
  return width;
}

/** escape를 보존하면서 표시 폭 maxVisible 까지만 남긴다. */
function sliceVisible(text: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  let out = "";
  let width = 0;
  let i = 0;
  while (i < text.length) {
    const escape = ANSI_ESCAPE_PATTERN.exec(text.slice(i));
    if (escape) {
      out += escape[0];
      i += escape[0].length;
      continue;
    }
    const cp = text.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    const w = codePointWidth(cp);
    if (width + w > maxVisible) break;
    out += ch;
    width += w;
    i += ch.length;
  }
  return out;
}

/** 잘린 자리에서 OSC 8 링크가 열려 있으면 닫아, 말줄임표까지 밑줄이 이어지지 않게 한다. */
function closeOpenHyperlink(text: string): string {
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  OSC8_OPEN_OR_CLOSE.lastIndex = 0;
  while ((match = OSC8_OPEN_OR_CLOSE.exec(text)) !== null) last = match;
  return last && last[1].length > 0 ? OSC8_CLOSE : "";
}

export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0 || visualWidth(text) <= maxWidth) return text;
  const suffix = maxWidth >= 3 ? "..." : ".".repeat(maxWidth);
  const sliced = sliceVisible(text, Math.max(0, maxWidth - suffix.length));
  return `${sliced}${closeOpenHyperlink(sliced)}${suffix}${RESET}`;
}

interface WrapPart {
  separator: string;
  segment: string;
}

/** " | " / " │ " 구분자 위치로 줄을 나눈다 (escape 안의 문자는 구분자로 보지 않는다). */
function splitWrapParts(line: string): WrapPart[] {
  const parts: WrapPart[] = [];
  let currentStart = 0;
  let separator = "";
  let i = 0;
  while (i < line.length) {
    const escape = ANSI_ESCAPE_PATTERN.exec(line.slice(i));
    if (escape) {
      i += escape[0].length;
      continue;
    }
    const found = line.startsWith(" | ", i) ? " | " : line.startsWith(" │ ", i) ? " │ " : null;
    if (found) {
      parts.push({ separator, segment: line.slice(currentStart, i) });
      separator = found;
      i += found.length;
      currentStart = i;
      continue;
    }
    i++;
  }
  parts.push({ separator, segment: line.slice(currentStart) });

  // 첫 세그먼트가 "[model" 처럼 열린 대괄호로 시작하면 닫히는 세그먼트까지 묶어 모델 배지가 갈라지지 않게 한다.
  const firstVisible = stripAnsi(parts[0].segment).trimStart();
  if (firstVisible.startsWith("[") && !stripAnsi(parts[0].segment).includes("]") && parts.length > 1) {
    let merged = parts[0].segment;
    let consume = 1;
    while (consume < parts.length) {
      const next = parts[consume];
      merged += `${next.separator}${next.segment}`;
      consume++;
      if (stripAnsi(next.segment).includes("]")) break;
    }
    return [{ separator: "", segment: merged }, ...parts.slice(consume)];
  }
  return parts;
}

/** 폭을 넘는 줄을 구분자에서 감는다. 한 세그먼트가 그 자체로 넘치면 자른다. */
export function wrapLineToWidth(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || visualWidth(line) <= maxWidth) return [line];
  const parts = splitWrapParts(line);
  if (parts.length <= 1) return [truncateToWidth(line, maxWidth)];

  const wrapped: string[] = [];
  let current = parts[0].segment;
  for (const part of parts.slice(1)) {
    const candidate = `${current}${part.separator}${part.segment}`;
    if (visualWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    wrapped.push(truncateToWidth(current, maxWidth));
    current = part.segment;
  }
  if (current) wrapped.push(truncateToWidth(current, maxWidth));
  return wrapped;
}

export function terminalWidth(configured: number | null, force = false): number | null {
  if (force && configured !== null) return configured;
  const env = Number.parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(env) && env > 0) return Math.min(1000, env);
  const cols = process.stdout?.columns;
  if (typeof cols === "number" && cols > 0) return Math.min(1000, cols);
  return configured;
}

/** 진행 바 폭 — 넓은 터미널 10칸, 중간 6칸, 좁으면 4칸 (claude-hud와 동일). */
export function adaptiveBarWidth(width: number | null): number {
  if (width === null) return 10;
  if (width >= 100) return 10;
  if (width >= 60) return 6;
  return 4;
}

/** OSC 8 하이퍼링크. https:/file: 만 허용하고, 그 외에는 텍스트만 돌려준다. */
export function safeHyperlink(uri: string | null | undefined, text: string): string {
  if (!uri) return text;
  try {
    const parsed = new URL(uri.replace(/[\p{Cc}\p{Cf}]/gu, ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "file:") return text;
    return `\x1b]8;;${parsed.toString()}\x1b\\${text}\x1b]8;;\x1b\\`;
  } catch {
    return text;
  }
}
