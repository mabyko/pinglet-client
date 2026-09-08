/**
 * HUD 설정 — claude-hud(jarrodwatts/claude-hud)와 같은 키 체계를 쓴다.
 * `~/.pinglet/config.json`의 `hud` 섹션에 저장되며, 값이 없거나 잘못되면
 * 기본값으로 되돌린다 (statusline 렌더 경로에서 예외를 던지지 않기 위해).
 */

export type LineLayout = "compact" | "expanded";
export type PathLevels = 1 | 2 | 3 | "full";
export type ContextValueMode = "percent" | "tokens" | "remaining" | "both";
export type UsageValueMode = "percent" | "remaining";
export type TimeFormatMode = "relative" | "absolute" | "both";
export type ModelFormatMode = "full" | "compact" | "short";
export type EffortFormatMode = "full" | "symbol" | "text";
export type GitBranchOverflowMode = "truncate" | "wrap";
export type HudPreset = "full" | "essential" | "minimal";

/** 확장 레이아웃에서 줄 단위로 배치되는 요소. elementOrder가 순서와 표시 여부를 정한다. */
export type HudElement =
  | "project"
  | "context"
  | "usage"
  | "promptCache"
  | "memory"
  | "tools"
  | "skills"
  | "agents"
  | "todos";

/** 첫 줄(project line) 안의 세그먼트. projectLineOrder로 순서를 바꾼다. */
export type FirstLineSegment =
  | "model"
  | "project"
  | "advisor"
  | "sessionName"
  | "duration"
  | "cost"
  | "speed";

export type HudColorName =
  | "dim"
  | "red"
  | "green"
  | "yellow"
  | "magenta"
  | "cyan"
  | "brightBlue"
  | "brightMagenta";
/** 이름, 256색 인덱스(0-255), 또는 #rrggbb. */
export type HudColorValue = HudColorName | number | string;

export interface HudColors {
  context: HudColorValue;
  usage: HudColorValue;
  warning: HudColorValue;
  usageWarning: HudColorValue;
  critical: HudColorValue;
  model: HudColorValue;
  project: HudColorValue;
  git: HudColorValue;
  gitBranch: HudColorValue;
  label: HudColorValue;
  barFilled: string;
  barEmpty: string;
}

export interface HudDisplay {
  showModel: boolean;
  modelFormat: ModelFormatMode;
  showProject: boolean;
  showContextBar: boolean;
  contextValue: ContextValueMode;
  showTokenBreakdown: boolean;
  showUsage: boolean;
  usageValue: UsageValueMode;
  usageBarEnabled: boolean;
  showResetLabel: boolean;
  usageCompact: boolean;
  /** 모델별 주간 창(`rate_limits.model_scoped`, 예: Fable 주간 한도)을 5h/7d 옆에 표시. */
  showModelScopedUsage: boolean;
  timeFormat: TimeFormatMode;
  showTools: boolean;
  toolNameMaxLength: number;
  toolsMaxVisible: number;
  /** 세션에서 호출된 Skill 이름 목록 줄. */
  showSkills: boolean;
  showAgents: boolean;
  showTodos: boolean;
  showSessionName: boolean;
  showDuration: boolean;
  showCost: boolean;
  /** 출력 속도(tok/s) — 이전 tick과의 output_tokens 증가분. */
  showSpeed: boolean;
  /** 모델 배지에 reasoning effort(low/medium/high/xhigh/max, ultracode) 표시. */
  showEffortLevel: boolean;
  effortFormat: EffortFormatMode;
  /** 세션 누적 토큰 줄 (transcript의 assistant usage 합). */
  showSessionTokens: boolean;
  /** 컨텍스트 압축 횟수 (/compact·자동 압축의 compact_boundary 기록 수). 0이면 숨김. */
  showCompactions: boolean;
  /** 기기 전체 RAM 사용률 줄 (expanded 레이아웃에서만). */
  showMemoryUsage: boolean;
  /** prompt cache 만료 시각 줄. */
  showPromptCache: boolean;
  /** transcript에서 TTL을 감지하지 못했을 때 쓰는 기본 TTL(초). */
  promptCacheTtlSeconds: number;
  /** Cache 줄 뒤에 마지막 요청의 캐시 히트율(cache_read / 전체 입력) 표시. */
  showCacheHitRate: boolean;
  /** `/advisor`로 지정한 자문 모델을 첫 줄에 표시. */
  showAdvisor: boolean;
  /** 비어 있지 않으면 transcript 값 대신 이 문자열을 그대로 표시. */
  advisorOverride: string;
  /** 인접한 요소를 같은 줄에 합친다 (터미널 폭이 허용할 때). */
  mergeGroups: HudElement[][];
  contextWarningThreshold: number;
  contextCriticalThreshold: number;
  /** 이 값 미만의 사용량이면 usage 줄을 숨긴다 (0 = 항상 표시). */
  usageThreshold: number;
  /** 7일 창은 이 값 이상일 때만 5시간 창 옆에 표시한다. */
  sevenDayThreshold: number;
}

export interface HudGitStatus {
  enabled: boolean;
  showDirty: boolean;
  showAheadBehind: boolean;
  /** 변경 파일 수·줄 수 (expanded: 배지의 [+a -d]와 변경 파일 줄, compact: Starship식 !m +a ✘d ?u). */
  showFileStats: boolean;
  /** 프로젝트 경로와 git 배지를 한 세그먼트로 두고 자를지(truncate), 따로 감을지(wrap). */
  branchOverflow: GitBranchOverflowMode;
  /** 푸시 안 한 커밋(↑n)이 이 값 이상이면 경고색 (0 = 끔). */
  pushWarningThreshold: number;
  pushCriticalThreshold: number;
}

export interface HudConfig {
  enabled: boolean;
  lineLayout: LineLayout;
  showSeparators: boolean;
  pathLevels: PathLevels;
  maxWidth: number | null;
  /** true면 감지한 터미널 폭 대신 maxWidth를 쓴다. */
  forceMaxWidth: boolean;
  elementOrder: HudElement[];
  projectLineOrder: FirstLineSegment[];
  gitStatus: HudGitStatus;
  display: HudDisplay;
  colors: HudColors;
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  "project",
  "context",
  "usage",
  "promptCache",
  "memory",
  "tools",
  "skills",
  "agents",
  "todos",
];
export const KNOWN_ELEMENTS: ReadonlySet<HudElement> = new Set(DEFAULT_ELEMENT_ORDER);
export const KNOWN_FIRST_LINE_SEGMENTS: ReadonlySet<FirstLineSegment> = new Set<FirstLineSegment>([
  "model",
  "project",
  "advisor",
  "sessionName",
  "duration",
  "cost",
  "speed",
]);
export const DEFAULT_MERGE_GROUPS: HudElement[][] = [["context", "usage"]];

/** 설정 파일에 없을 때 쓰는 기본값 — claude-hud의 "full" 프리셋과 같다. */
export const DEFAULT_HUD_CONFIG: HudConfig = {
  enabled: true,
  lineLayout: "expanded",
  showSeparators: false,
  pathLevels: 1,
  maxWidth: null,
  forceMaxWidth: false,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  projectLineOrder: [],
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: true,
    showFileStats: true,
    branchOverflow: "truncate",
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  },
  display: {
    showModel: true,
    modelFormat: "full",
    showProject: true,
    showContextBar: true,
    contextValue: "percent",
    showTokenBreakdown: true,
    showUsage: true,
    usageValue: "percent",
    usageBarEnabled: true,
    showResetLabel: true,
    usageCompact: false,
    showModelScopedUsage: true,
    timeFormat: "relative",
    showTools: true,
    toolNameMaxLength: 0,
    toolsMaxVisible: 4,
    showSkills: true,
    showAgents: true,
    showTodos: true,
    showSessionName: true,
    showDuration: true,
    showCost: true,
    showSpeed: true,
    showEffortLevel: true,
    effortFormat: "full",
    showSessionTokens: true,
    showCompactions: true,
    showMemoryUsage: true,
    showPromptCache: true,
    promptCacheTtlSeconds: 300,
    showCacheHitRate: true,
    showAdvisor: true,
    advisorOverride: "",
    mergeGroups: DEFAULT_MERGE_GROUPS.map((group) => [...group]),
    contextWarningThreshold: 70,
    contextCriticalThreshold: 85,
    usageThreshold: 0,
    sevenDayThreshold: 80,
  },
  colors: {
    context: "green",
    usage: "brightBlue",
    warning: "yellow",
    usageWarning: "brightMagenta",
    critical: "red",
    model: "cyan",
    project: "yellow",
    git: "magenta",
    gitBranch: "cyan",
    label: "dim",
    barFilled: "█",
    barEmpty: "░",
  },
};

/** `pinglet hud --show/--hide`에서 받는 토글 이름 → 설정 경로. */
export const TOGGLE_KEYS: Record<string, `display.${keyof HudDisplay}` | `gitStatus.${keyof HudGitStatus}`> = {
  model: "display.showModel",
  project: "display.showProject",
  context: "display.showContextBar",
  "context-bar": "display.showContextBar",
  usage: "display.showUsage",
  "model-scoped-usage": "display.showModelScopedUsage",
  tools: "display.showTools",
  skills: "display.showSkills",
  agents: "display.showAgents",
  todos: "display.showTodos",
  memory: "display.showMemoryUsage",
  "prompt-cache": "display.showPromptCache",
  "cache-hit": "display.showCacheHitRate",
  advisor: "display.showAdvisor",
  "session-name": "display.showSessionName",
  duration: "display.showDuration",
  cost: "display.showCost",
  speed: "display.showSpeed",
  effort: "display.showEffortLevel",
  "session-tokens": "display.showSessionTokens",
  compactions: "display.showCompactions",
  "token-breakdown": "display.showTokenBreakdown",
  "usage-bar": "display.usageBarEnabled",
  "reset-label": "display.showResetLabel",
  "usage-compact": "display.usageCompact",
  git: "gitStatus.enabled",
  "git-dirty": "gitStatus.showDirty",
  "git-ahead-behind": "gitStatus.showAheadBehind",
  "git-files": "gitStatus.showFileStats",
};

/** 프리셋이 손대는 토글 — 나머지 키는 프리셋을 바꿔도 그대로 둔다. */
const PRESET_TOGGLES = [
  "model", "project", "context", "usage", "model-scoped-usage", "tools", "skills", "agents", "todos",
  "memory", "prompt-cache", "cache-hit", "advisor", "session-name", "duration", "cost", "speed", "effort",
  "session-tokens", "compactions", "git", "git-ahead-behind", "git-files",
] as const;

/**
 * 프리셋 — claude-hud의 setup/configure 흐름과 같은 세 단계.
 *   full:      모두 켜기
 *   essential: 활동 줄(tools/skills/agents/todos) + 모델·프로젝트·컨텍스트·git 브랜치, 정보 최소
 *   minimal:   모델명 + context bar만
 */
export const PRESETS: Record<HudPreset, ReadonlySet<(typeof PRESET_TOGGLES)[number]>> = {
  full: new Set(PRESET_TOGGLES),
  essential: new Set(["model", "project", "context", "tools", "skills", "agents", "todos", "git"] as const),
  minimal: new Set(["model", "context"] as const),
};

export function setToggle(config: HudConfig, name: string, value: boolean): void {
  const target = TOGGLE_KEYS[name];
  if (!target) return;
  const [section, key] = target.split(".") as ["display" | "gitStatus", string];
  (config[section] as unknown as Record<string, unknown>)[key] = value;
}

export function applyPreset(config: HudConfig, preset: HudPreset): HudConfig {
  const next = structuredClone(config);
  const on = PRESETS[preset];
  for (const name of PRESET_TOGGLES) setToggle(next, name, on.has(name));
  return next;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
const int = (v: unknown, fallback: number, min = 0, max = 100_000): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.trunc(v) : fallback;

function uniqueKnown<T extends string>(value: unknown, known: ReadonlySet<T>): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (typeof item === "string" && known.has(item as T) && !out.includes(item as T)) out.push(item as T);
  }
  return out;
}

const COLOR_NAMES: readonly HudColorName[] = [
  "dim", "red", "green", "yellow", "magenta", "cyan", "brightBlue", "brightMagenta",
];

function colorValue(value: unknown, fallback: HudColorValue): HudColorValue {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) return value;
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (typeof value === "string" && (COLOR_NAMES as readonly string[]).includes(value)) return value;
  return fallback;
}

/** 바 문자: 제어·서식 문자를 제외한 단일 grapheme만 허용한다 (터미널 방어). */
function barChar(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4) return fallback;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return fallback;
  return Array.from(value).length === 1 ? value : fallback;
}

/** 어떤 입력이 와도 유효한 HudConfig를 돌려준다. 알 수 없는 키는 버린다. */
export function normalizeHudConfig(raw: unknown): HudConfig {
  const d = DEFAULT_HUD_CONFIG;
  if (!isObject(raw)) return structuredClone(d);
  const display = isObject(raw.display) ? raw.display : {};
  const git = isObject(raw.gitStatus) ? raw.gitStatus : {};
  const colors = isObject(raw.colors) ? raw.colors : {};

  const elementOrder = uniqueKnown<HudElement>(raw.elementOrder, KNOWN_ELEMENTS);
  const mergeGroups = Array.isArray(display.mergeGroups)
    ? display.mergeGroups
        .map((group) => uniqueKnown<HudElement>(group, KNOWN_ELEMENTS))
        .filter((group) => group.length > 1)
    : d.display.mergeGroups.map((group) => [...group]);

  const warning = int(display.contextWarningThreshold, d.display.contextWarningThreshold, 0, 100);
  const critical = int(display.contextCriticalThreshold, d.display.contextCriticalThreshold, 0, 100);

  return {
    enabled: bool(raw.enabled, d.enabled),
    lineLayout: oneOf(raw.lineLayout, ["compact", "expanded"] as const, d.lineLayout),
    showSeparators: bool(raw.showSeparators, d.showSeparators),
    pathLevels: oneOf(raw.pathLevels, [1, 2, 3, "full"] as const, d.pathLevels),
    maxWidth: typeof raw.maxWidth === "number" && raw.maxWidth > 0 ? Math.min(1000, Math.trunc(raw.maxWidth)) : null,
    forceMaxWidth: bool(raw.forceMaxWidth, d.forceMaxWidth),
    elementOrder: elementOrder.length > 0 ? elementOrder : [...d.elementOrder],
    projectLineOrder: uniqueKnown<FirstLineSegment>(raw.projectLineOrder, KNOWN_FIRST_LINE_SEGMENTS),
    gitStatus: {
      enabled: bool(git.enabled, d.gitStatus.enabled),
      showDirty: bool(git.showDirty, d.gitStatus.showDirty),
      showAheadBehind: bool(git.showAheadBehind, d.gitStatus.showAheadBehind),
      showFileStats: bool(git.showFileStats, d.gitStatus.showFileStats),
      branchOverflow: oneOf(git.branchOverflow, ["truncate", "wrap"] as const, d.gitStatus.branchOverflow),
      pushWarningThreshold: int(git.pushWarningThreshold, d.gitStatus.pushWarningThreshold, 0, 10_000),
      pushCriticalThreshold: int(git.pushCriticalThreshold, d.gitStatus.pushCriticalThreshold, 0, 10_000),
    },
    display: {
      showModel: bool(display.showModel, d.display.showModel),
      modelFormat: oneOf(display.modelFormat, ["full", "compact", "short"] as const, d.display.modelFormat),
      showProject: bool(display.showProject, d.display.showProject),
      showContextBar: bool(display.showContextBar, d.display.showContextBar),
      contextValue: oneOf(display.contextValue, ["percent", "tokens", "remaining", "both"] as const, d.display.contextValue),
      showTokenBreakdown: bool(display.showTokenBreakdown, d.display.showTokenBreakdown),
      showUsage: bool(display.showUsage, d.display.showUsage),
      usageValue: oneOf(display.usageValue, ["percent", "remaining"] as const, d.display.usageValue),
      usageBarEnabled: bool(display.usageBarEnabled, d.display.usageBarEnabled),
      showResetLabel: bool(display.showResetLabel, d.display.showResetLabel),
      usageCompact: bool(display.usageCompact, d.display.usageCompact),
      showModelScopedUsage: bool(display.showModelScopedUsage, d.display.showModelScopedUsage),
      timeFormat: oneOf(display.timeFormat, ["relative", "absolute", "both"] as const, d.display.timeFormat),
      showTools: bool(display.showTools, d.display.showTools),
      toolNameMaxLength: int(display.toolNameMaxLength, d.display.toolNameMaxLength, 0, 64),
      toolsMaxVisible: int(display.toolsMaxVisible, d.display.toolsMaxVisible, 0, 20),
      showSkills: bool(display.showSkills, d.display.showSkills),
      showAgents: bool(display.showAgents, d.display.showAgents),
      showTodos: bool(display.showTodos, d.display.showTodos),
      showSessionName: bool(display.showSessionName, d.display.showSessionName),
      showDuration: bool(display.showDuration, d.display.showDuration),
      showCost: bool(display.showCost, d.display.showCost),
      showSpeed: bool(display.showSpeed, d.display.showSpeed),
      showEffortLevel: bool(display.showEffortLevel, d.display.showEffortLevel),
      effortFormat: oneOf(display.effortFormat, ["full", "symbol", "text"] as const, d.display.effortFormat),
      showSessionTokens: bool(display.showSessionTokens, d.display.showSessionTokens),
      showCompactions: bool(display.showCompactions, d.display.showCompactions),
      showMemoryUsage: bool(display.showMemoryUsage, d.display.showMemoryUsage),
      showPromptCache: bool(display.showPromptCache, d.display.showPromptCache),
      promptCacheTtlSeconds: int(display.promptCacheTtlSeconds, d.display.promptCacheTtlSeconds, 1, 86_400),
      showCacheHitRate: bool(display.showCacheHitRate, d.display.showCacheHitRate),
      showAdvisor: bool(display.showAdvisor, d.display.showAdvisor),
      advisorOverride: typeof display.advisorOverride === "string" ? display.advisorOverride.slice(0, 64) : "",
      mergeGroups,
      contextWarningThreshold: Math.min(warning, critical),
      contextCriticalThreshold: critical,
      usageThreshold: int(display.usageThreshold, d.display.usageThreshold, 0, 100),
      sevenDayThreshold: int(display.sevenDayThreshold, d.display.sevenDayThreshold, 0, 100),
    },
    colors: {
      context: colorValue(colors.context, d.colors.context),
      usage: colorValue(colors.usage, d.colors.usage),
      warning: colorValue(colors.warning, d.colors.warning),
      usageWarning: colorValue(colors.usageWarning, d.colors.usageWarning),
      critical: colorValue(colors.critical, d.colors.critical),
      model: colorValue(colors.model, d.colors.model),
      project: colorValue(colors.project, d.colors.project),
      git: colorValue(colors.git, d.colors.git),
      gitBranch: colorValue(colors.gitBranch, d.colors.gitBranch),
      label: colorValue(colors.label, d.colors.label),
      barFilled: barChar(colors.barFilled, d.colors.barFilled),
      barEmpty: barChar(colors.barEmpty, d.colors.barEmpty),
    },
  };
}
