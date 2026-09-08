/**
 * Claude Code statusLine hook이 stdin으로 넘기는 JSON payload.
 * 모든 필드는 optional — 버전에 따라 없을 수 있고, 값은 신뢰하지 않는다.
 */
export interface StatuslinePayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  workspace?: { current_dir?: string; project_dir?: string } | null;
  model?: { id?: string; display_name?: string };
  context_window?: {
    context_window_size?: number;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  };
  cost?: {
    total_cost_usd?: number | null;
    total_duration_ms?: number | null;
    total_api_duration_ms?: number | null;
  } | null;
  rate_limits?: {
    five_hour?: { used_percentage?: number | null; resets_at?: number | null } | null;
    seven_day?: { used_percentage?: number | null; resets_at?: number | null } | null;
    /** 모델별 주간 창 (예: Fable 주간 한도). 서버가 줄 때만 포함된다. */
    model_scoped?: Array<{ display_name?: string | null; utilization?: number | null; resets_at?: string | null }> | null;
  } | null;
  /** Claude Code 2.1.115+ 는 `{ level: "max" }` 객체, 그 전엔 없거나 문자열. */
  effort?: string | { level?: string | null } | null;
}

export interface ScopedUsageWindow {
  label: string;
  percent: number | null;
  resetAt: Date | null;
}

export interface UsageData {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  scopedWindows: ScopedUsageWindow[];
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function getTotalTokens(payload: StatuslinePayload): number {
  const usage = payload.context_window?.current_usage;
  return (
    (num(usage?.input_tokens) ?? 0) +
    (num(usage?.cache_creation_input_tokens) ?? 0) +
    (num(usage?.cache_read_input_tokens) ?? 0)
  );
}

/**
 * 컨텍스트 사용률. Claude Code가 주는 used_percentage를 우선하고(/context와 일치),
 * 0이거나 없으면 토큰 합/창 크기로 계산한다 — 첫 응답 전에는 used_percentage가
 * 0으로 오지만 current_usage에는 초기 컨텍스트(시스템 프롬프트 등)가 이미 있다.
 */
export function getContextPercent(payload: StatuslinePayload): number {
  const native = num(payload.context_window?.used_percentage);
  if (native !== null && native > 0) return Math.min(100, Math.max(0, Math.round(native)));
  const size = num(payload.context_window?.context_window_size);
  if (!size || size <= 0) return 0;
  return Math.min(100, Math.round((getTotalTokens(payload) / size) * 100));
}

export function getModelName(payload: StatuslinePayload): string {
  const displayName = payload.model?.display_name?.trim();
  if (displayName) return displayName;
  return payload.model?.id?.trim() || "Unknown";
}

/**
 *   full:    표시 이름 그대로 (예: "Opus 4.6 (1M context)")
 *   compact: 컨텍스트 창 접미사 제거 (예: "Opus 4.6")
 *   short:   접미사와 "Claude " 접두사 모두 제거
 */
export function formatModelName(name: string, format: "full" | "compact" | "short"): string {
  if (format === "full") return name;
  let result = name.replace(/\s*\([^)]*\bcontext\b[^)]*\)/i, "").trim();
  if (format === "short") result = result.replace(/^Claude\s+/i, "");
  return result;
}

const EFFORT_SYMBOLS: Record<string, string> = {
  low: "○",
  medium: "◔",
  high: "◑",
  xhigh: "◕",
  max: "●",
};

export interface EffortInfo {
  level: string;
  symbol: string;
}

/**
 * stdin의 effort(문자열 또는 `{ level }`)를 표시용으로 정리한다.
 * ultracode는 stdin에 일반 레벨로 오므로 transcript 신호가 있으면 `ultracode(<level>)`로 감싼다.
 */
export function resolveEffortLevel(effort: StatuslinePayload["effort"], ultracodeActive?: boolean): EffortInfo | null {
  const raw = typeof effort === "string"
    ? effort
    : effort && typeof effort === "object" && typeof effort.level === "string" ? effort.level : "";
  const level = raw.toLowerCase().trim().replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 16);
  if (!level) return null;
  const symbol = EFFORT_SYMBOLS[level] ?? "";
  return ultracodeActive === true ? { level: `ultracode(${level})`, symbol } : { level, symbol };
}

function percent(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(Math.min(100, Math.max(0, n)));
}

function resetAt(v: unknown): Date | null {
  const n = num(v);
  return n === null || n <= 0 ? null : new Date(n * 1000);
}

const SCOPED_MAX_WINDOWS = 8;

/** `rate_limits.model_scoped` — 잘못된 항목은 버리고 개수·라벨 길이를 제한한다 (stdin은 신뢰하지 않는다). */
export function parseScopedWindows(modelScoped: unknown): ScopedUsageWindow[] {
  if (!Array.isArray(modelScoped)) return [];
  const windows: ScopedUsageWindow[] = [];
  for (const raw of modelScoped) {
    if (windows.length >= SCOPED_MAX_WINDOWS) break;
    const entry = raw as { display_name?: unknown; utilization?: unknown; resets_at?: unknown } | null;
    const label = typeof entry?.display_name === "string"
      ? entry.display_name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 64)
      : "";
    if (!label) continue;
    const utilization = entry?.utilization;
    const value = utilization === null ? null : percent(utilization);
    if (utilization !== null && value === null) continue;
    const resetRaw = entry?.resets_at;
    const reset = typeof resetRaw === "string" && resetRaw.length <= 64 && !Number.isNaN(Date.parse(resetRaw))
      ? new Date(resetRaw)
      : null;
    windows.push({ label, percent: value, resetAt: reset });
  }
  return windows;
}

export function getUsage(payload: StatuslinePayload): UsageData | null {
  const limits = payload.rate_limits;
  if (!limits) return null;
  const fiveHour = percent(limits.five_hour?.used_percentage);
  const sevenDay = percent(limits.seven_day?.used_percentage);
  const scopedWindows = parseScopedWindows(limits.model_scoped);
  if (fiveHour === null && sevenDay === null && scopedWindows.length === 0) return null;
  return {
    fiveHour,
    sevenDay,
    fiveHourResetAt: resetAt(limits.five_hour?.resets_at),
    sevenDayResetAt: resetAt(limits.seven_day?.resets_at),
    scopedWindows,
  };
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(Math.max(0, Math.trunc(n)));
}

export function formatUsd(v: number): string {
  return v >= 100 ? `$${v.toFixed(0)}` : v >= 10 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`;
}
