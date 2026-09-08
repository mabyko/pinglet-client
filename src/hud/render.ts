import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { FirstLineSegment, HudConfig, HudElement, PathLevels } from "./config";
import {
  contextBar, contextColor, critical, cyan, dim, git as gitColor, gitBranch as branchColor,
  green, label, magenta, model as modelColor, project as projectColor, quotaBar, quotaColor,
  red, RESET, warning, yellow,
} from "./colors";
import {
  EffortInfo, StatuslinePayload, UsageData, formatModelName, formatTokens, formatUsd,
  getContextPercent, getModelName, getTotalTokens, getUsage, resolveEffortLevel,
} from "./stdin";
import { AgentEntry, SessionTokenUsage, TranscriptData, sanitizeText } from "./transcript";
import { GitStatus } from "./git";
import { MemoryInfo, formatBytes } from "./memory";
import { hudLabel } from "./labels";
import { adaptiveBarWidth, safeHyperlink, terminalWidth, visualWidth, wrapLineToWidth } from "./width";

/**
 * HUD 렌더러 — claude-hud와 같은 요소·레이아웃 규칙으로 줄 목록을 만든다.
 *   expanded: elementOrder 순서대로 요소마다 한 줄, mergeGroups는 폭이 허용하면 한 줄로 합침,
 *             그 뒤에 세션 토큰·압축 횟수·변경 파일 줄
 *   compact:  세션 정보를 한 줄에, 활동 줄(tools/skills/agents/todos)은 아래에
 * 폭을 넘는 줄은 구분자에서 감는다. 결과는 statusline의 "함께 코딩 중" 줄 아래에 붙는다.
 */
export interface HudContext {
  config: HudConfig;
  payload: StatuslinePayload;
  transcript: TranscriptData;
  gitStatus: GitStatus | null;
  memory: MemoryInfo | null;
  /** 출력 속도(tok/s) — 측정 불가면 null. */
  speed: number | null;
  now: number;
}

const ACTIVITY: ReadonlySet<HudElement> = new Set<HudElement>(["tools", "skills", "agents", "todos"]);
const SEP = " │ ";
const COMPLETED_AGENT_RETENTION_MS = 60_000;

export function renderHud(ctx: HudContext): string[] {
  const width = terminalWidth(ctx.config.maxWidth, ctx.config.forceMaxWidth);
  const lines = ctx.config.lineLayout === "expanded" ? renderExpanded(ctx, width) : renderCompact(ctx, width);
  const physical = lines.flatMap((line) => line.split("\n"));
  const fitted = width === null ? physical : physical.flatMap((line) => wrapLineToWidth(line, width));
  return fitted.map((line) => `${RESET}${line}`);
}

// ---------------------------------------------------------------- layouts

function renderExpanded(ctx: HudContext, width: number | null): string[] {
  const { elementOrder, display, showSeparators } = ctx.config;
  const groupOf = new Map<HudElement, Set<HudElement>>();
  for (const group of display.mergeGroups) {
    const set = new Set(group);
    for (const element of group) if (!groupOf.has(element)) groupOf.set(element, set);
  }

  const rendered: Array<{ line: string; activity: boolean }> = [];
  const seen = new Set<HudElement>();
  for (let index = 0; index < elementOrder.length; index++) {
    const element = elementOrder[index];
    if (seen.has(element)) continue;
    const group = groupOf.get(element);
    // 같은 merge group에 속한 연속 요소를 모아 한 줄 후보로 만든다.
    const sequence: HudElement[] = [];
    if (group) {
      for (let j = index; j < elementOrder.length; j++) {
        const candidate = elementOrder[j];
        if (seen.has(candidate) || !group.has(candidate)) break;
        sequence.push(candidate);
      }
    }
    if (sequence.length > 1) {
      index += sequence.length - 1;
      sequence.forEach((e) => seen.add(e));
      const parts = sequence
        .map((e) => ({ element: e, line: renderElement(ctx, e, width) }))
        .filter((p): p is { element: HudElement; line: string } => !!p.line);
      if (parts.length === 0) continue;
      const combined = parts.map((p) => p.line).join(SEP);
      if (parts.length === 1 || width === null || visualWidth(combined) <= width) {
        rendered.push({ line: combined, activity: parts.some((p) => ACTIVITY.has(p.element)) });
      } else {
        parts.forEach((p) => rendered.push({ line: p.line, activity: ACTIVITY.has(p.element) }));
      }
      continue;
    }
    seen.add(element);
    const line = renderElement(ctx, element, width);
    if (line) rendered.push({ line, activity: ACTIVITY.has(element) });
  }

  const gitFiles = renderGitFilesLine(ctx, width);
  if (gitFiles) rendered.push({ line: gitFiles, activity: false });

  const lines = rendered.map((r) => r.line);
  const sessionTokens = renderSessionTokensLine(ctx);
  if (sessionTokens) lines.push(sessionTokens);
  const compactions = renderCompactionsLine(ctx);
  if (compactions) lines.push(compactions);

  if (showSeparators) {
    const firstActivity = rendered.findIndex((r) => r.activity);
    if (firstActivity > 0) lines.splice(firstActivity, 0, separator(rendered.slice(0, firstActivity).map((r) => r.line), width));
  }
  return lines;
}

function renderCompact(ctx: HudContext, width: number | null): string[] {
  const lines: string[] = [];
  const session = renderSessionLine(ctx, width);
  if (session) lines.push(session);
  const activity = (["tools", "skills", "agents", "todos"] as HudElement[])
    .map((e) => renderElement(ctx, e, width))
    .filter((line): line is string => !!line);
  if (ctx.config.showSeparators && activity.length > 0 && lines.length > 0) lines.push(separator(lines, width));
  lines.push(...activity);
  return lines;
}

function separator(above: string[], width: number | null): string {
  const base = Math.max(20, ...above.map(visualWidth));
  const length = width === null ? base : Math.min(base, width);
  return dim("─".repeat(length));
}

function renderElement(ctx: HudContext, element: HudElement, width: number | null): string | null {
  const { display } = ctx.config;
  switch (element) {
    case "project":
      return renderProjectLine(ctx);
    case "context":
      return renderContextLine(ctx, width);
    case "usage":
      return renderUsageLine(ctx, width);
    case "promptCache":
      return display.showPromptCache ? renderPromptCacheLine(ctx) : null;
    case "memory":
      return display.showMemoryUsage && ctx.config.lineLayout === "expanded" ? renderMemoryLine(ctx, width) : null;
    case "tools":
      return display.showTools ? renderToolsLine(ctx) : null;
    case "skills":
      return display.showSkills ? renderSkillsLine(ctx) : null;
    case "agents":
      return display.showAgents ? renderAgentsLine(ctx) : null;
    case "todos":
      return display.showTodos ? renderTodosLine(ctx) : null;
  }
}

// ---------------------------------------------------------------- first line

interface Part {
  key: FirstLineSegment | null;
  text: string;
}

/** projectLineOrder에 적힌 세그먼트를 앞으로 당기고 나머지는 원래 순서를 유지한다. */
function orderParts(parts: Part[], order: FirstLineSegment[]): string[] {
  if (order.length === 0) return parts.map((p) => p.text);
  const used = new Set<number>();
  const out: string[] = [];
  for (const key of order) {
    parts.forEach((part, i) => {
      if (!used.has(i) && part.key === key) {
        used.add(i);
        out.push(part.text);
      }
    });
  }
  parts.forEach((part, i) => {
    if (!used.has(i)) out.push(part.text);
  });
  return out;
}

export function formatProjectPath(cwd: string, levels: PathLevels): string {
  const safe = sanitizeText(cwd, 512);
  const segments = safe.split(/[/\\]/).filter(Boolean);
  if (levels !== "full") {
    const shown = segments.slice(-levels).join("/");
    return shown || (/^[/\\]/.test(safe) ? "/" : safe);
  }
  if (/^[A-Za-z]:[\\/]/.test(safe)) return segments.join("/");
  return `${/^[/\\]/.test(safe) ? "/" : ""}${segments.join("/")}` || safe;
}

function fileHref(filePath: string): string | null {
  try {
    return pathToFileURL(path.resolve(filePath)).toString();
  } catch {
    return null;
  }
}

function currentDir(ctx: HudContext): string | undefined {
  const cwd = ctx.payload.cwd ?? ctx.payload.workspace?.current_dir;
  return typeof cwd === "string" && cwd ? cwd : undefined;
}

/** "claude-opus-4-7" → "Opus 4.7", "opus" → "Opus". 모르는 형태는 접두사만 뗀다. */
export function prettifyAdvisorId(rawId: string): string {
  const id = rawId.trim();
  const match = id.match(/^(?:claude-)?(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i);
  if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}.${match[3]}`;
  const lower = id.toLowerCase();
  if (["opus", "sonnet", "haiku", "fable"].includes(lower)) return lower[0].toUpperCase() + lower.slice(1);
  return id.replace(/^claude-/i, "");
}

function advisorSegment(ctx: HudContext): string | null {
  const { display, colors } = ctx.config;
  if (!display.showAdvisor) return null;
  const override = sanitizeText(display.advisorOverride, 64);
  const raw = override || ctx.transcript.advisorModel;
  if (!raw) return null;
  const pretty = sanitizeText(override ? raw : prettifyAdvisorId(raw), 64);
  return pretty ? `${label(`${hudLabel("advisor")}:`, colors)} ${pretty}` : null;
}

function effortSuffix(ctx: HudContext): string {
  const { display } = ctx.config;
  if (!display.showEffortLevel) return "";
  const info: EffortInfo | null = resolveEffortLevel(ctx.payload.effort, ctx.transcript.ultracodeActive);
  if (!info) return "";
  const isUltracode = info.level.startsWith("ultracode(");
  if (display.effortFormat === "symbol" && info.symbol && !isUltracode) return ` ${info.symbol}`;
  if (display.effortFormat === "text" || !info.symbol) return ` ${info.level}`;
  return ` ${info.symbol} ${info.level}`;
}

function modelBadge(ctx: HudContext): string {
  const { display, colors } = ctx.config;
  const name = formatModelName(getModelName(ctx.payload), display.modelFormat);
  return modelColor(`[${name}${effortSuffix(ctx)}]`, colors);
}

function aheadText(ctx: HudContext, ahead: number): string {
  const { gitStatus: cfg, colors } = ctx.config;
  const value = `↑${ahead}`;
  if (cfg.pushCriticalThreshold > 0 && ahead >= cfg.pushCriticalThreshold) return critical(value, colors);
  if (cfg.pushWarningThreshold > 0 && ahead >= cfg.pushWarningThreshold) return warning(value, colors);
  return branchColor(value, colors);
}

/** expanded 첫 줄의 git 배지: `git:(main* ↑2 ↓1 [+12 -3])` — 브랜치는 GitHub 링크. */
function gitBadgeExpanded(ctx: HudContext): string {
  const { gitStatus: git } = ctx;
  const { gitStatus: cfg, colors } = ctx.config;
  if (!git || !cfg.enabled) return "";
  const branchText = git.branch + (cfg.showDirty && git.isDirty ? "*" : "");
  const inner: string[] = [safeHyperlink(git.branchUrl, branchColor(branchText, colors))];
  if (cfg.showAheadBehind && git.ahead > 0) inner.push(aheadText(ctx, git.ahead));
  if (cfg.showAheadBehind && git.behind > 0) inner.push(branchColor(`↓${git.behind}`, colors));
  if (cfg.showFileStats && git.lineDiff) {
    const diff: string[] = [];
    if (git.lineDiff.added > 0) diff.push(green(`+${git.lineDiff.added}`));
    if (git.lineDiff.deleted > 0) diff.push(red(`-${git.lineDiff.deleted}`));
    if (diff.length > 0) inner.push(`[${diff.join(" ")}]`);
  }
  return `${gitColor("git:(", colors)}${inner.join(" ")}${gitColor(")", colors)}`;
}

/** compact 세션 줄의 git 배지: Starship식 `git:(main* ↑2 !3 +1 ✘1 ?2)`. */
function gitBadgeCompact(ctx: HudContext): string {
  const { gitStatus: git } = ctx;
  const { gitStatus: cfg, colors } = ctx.config;
  if (!git || !cfg.enabled) return "";
  const parts: string[] = [git.branch];
  if (cfg.showDirty && git.isDirty) parts.push("*");
  if (cfg.showAheadBehind && git.ahead > 0) parts.push(` ↑${git.ahead}`);
  if (cfg.showAheadBehind && git.behind > 0) parts.push(` ↓${git.behind}`);
  if (cfg.showFileStats && git.fileStats) {
    const { modified, added, deleted, untracked } = git.fileStats;
    const stats: string[] = [];
    if (modified > 0) stats.push(`!${modified}`);
    if (added > 0) stats.push(`+${added}`);
    if (deleted > 0) stats.push(`✘${deleted}`);
    if (untracked > 0) stats.push(`?${untracked}`);
    if (stats.length > 0) parts.push(` ${stats.join(" ")}`);
  }
  return `${gitColor("git:(", colors)}${branchColor(parts.join(""), colors)}${gitColor(")", colors)}`;
}

function pushProjectParts(ctx: HudContext, gitPart: string, push: (text: string, key: FirstLineSegment) => void, linkPath: boolean): void {
  const { display, pathLevels, colors, gitStatus: cfg } = ctx.config;
  const cwd = currentDir(ctx);
  let projectPart: string | null = null;
  if (display.showProject && cwd) {
    const colored = projectColor(formatProjectPath(cwd, pathLevels), colors);
    projectPart = linkPath ? safeHyperlink(fileHref(cwd), colored) : colored;
  }
  if (projectPart && gitPart) {
    if (cfg.branchOverflow === "wrap") {
      push(projectPart, "project");
      push(gitPart, "project");
    } else {
      push(`${projectPart} ${gitPart}`, "project");
    }
  } else if (projectPart) {
    push(projectPart, "project");
  } else if (gitPart) {
    push(gitPart, "project");
  }
}

function trailingSegments(ctx: HudContext, push: (text: string, key: FirstLineSegment) => void): void {
  const { display, colors } = ctx.config;
  const advisor = advisorSegment(ctx);
  if (advisor) push(advisor, "advisor");
  if (display.showSessionName && ctx.transcript.sessionName) push(label(ctx.transcript.sessionName, colors), "sessionName");
  if (display.showDuration) {
    const duration = formatSessionDuration(ctx.transcript.sessionStart, ctx.now);
    if (duration) push(label(`⏱ ${duration}`, colors), "duration");
  }
  if (display.showCost) {
    const cost = ctx.payload.cost?.total_cost_usd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
      push(label(`${hudLabel("cost")} ${formatUsd(cost)}`, colors), "cost");
    }
  }
  if (display.showSpeed && ctx.speed !== null && Number.isFinite(ctx.speed)) {
    push(label(`${hudLabel("out")}: ${ctx.speed.toFixed(1)} ${hudLabel("tokPerSec")}`, colors), "speed");
  }
}

export function formatSessionDuration(sessionStart: number | undefined, now: number): string {
  if (sessionStart === undefined) return "";
  const mins = Math.floor(Math.max(0, now - sessionStart) / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function renderProjectLine(ctx: HudContext): string | null {
  const { display, projectLineOrder } = ctx.config;
  const parts: Part[] = [];
  const push = (text: string, key: FirstLineSegment | null = null) => parts.push({ key, text });

  if (display.showModel) push(modelBadge(ctx), "model");
  pushProjectParts(ctx, gitBadgeExpanded(ctx), push, true);
  trailingSegments(ctx, push);
  if (parts.length === 0) return null;
  return orderParts(parts, projectLineOrder).join(SEP);
}

/** compact 레이아웃의 한 줄 — 모델+컨텍스트 바, 프로젝트, 사용량, 부가 정보를 " | "로 잇는다. */
function renderSessionLine(ctx: HudContext, width: number | null): string | null {
  const { display, colors, projectLineOrder } = ctx.config;
  const parts: Part[] = [];
  const push = (text: string, key: FirstLineSegment | null = null) => parts.push({ key, text });

  const percent = getContextPercent(ctx.payload);
  const thresholds = { warning: display.contextWarningThreshold, critical: display.contextCriticalThreshold };
  const value = `${contextColor(percent, colors, thresholds)}${formatContextValue(ctx, percent)}${RESET}`;
  const bar = contextBar(percent, adaptiveBarWidth(width), colors, thresholds);
  const head = [display.showModel ? modelBadge(ctx) : "", display.showContextBar ? bar : "", value].filter(Boolean).join(" ");
  push(head, "model");

  pushProjectParts(ctx, gitBadgeCompact(ctx), push, false);
  usageParts(ctx, width).forEach((part) => push(part));
  const sessionTokens = sessionTokenSummary(ctx.transcript.sessionTokens, `${hudLabel("tok")}:`);
  if (display.showSessionTokens && sessionTokens) push(label(sessionTokens, colors));
  if (display.showCompactions && (ctx.transcript.compactionCount ?? 0) > 0) {
    push(label(`${hudLabel("compactions")}: ${ctx.transcript.compactionCount}`, colors));
  }
  trailingSegments(ctx, push);

  let line = orderParts(parts, projectLineOrder).join(" | ");
  const breakdown = tokenBreakdown(ctx, percent);
  if (breakdown) line += breakdown;
  return line;
}

// ---------------------------------------------------------------- context / usage

function formatContextValue(ctx: HudContext, percent: number): string {
  const mode = ctx.config.display.contextValue;
  const total = getTotalTokens(ctx.payload);
  const size = ctx.payload.context_window?.context_window_size ?? 0;
  if (mode === "tokens") return size > 0 ? `${formatTokens(total)}/${formatTokens(size)}` : formatTokens(total);
  if (mode === "both") return size > 0 ? `${percent}% (${formatTokens(total)}/${formatTokens(size)})` : `${percent}%`;
  if (mode === "remaining") return `${Math.max(0, 100 - percent)}%`;
  return `${percent}%`;
}

function tokenBreakdown(ctx: HudContext, percent: number): string {
  const { display, colors } = ctx.config;
  if (!display.showTokenBreakdown || percent < display.contextCriticalThreshold) return "";
  const usage = ctx.payload.context_window?.current_usage;
  if (!usage) return "";
  const input = formatTokens(usage.input_tokens ?? 0);
  const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
  return label(` (${hudLabel("in")}: ${input}, ${hudLabel("cache")}: ${cache})`, colors);
}

function renderContextLine(ctx: HudContext, width: number | null): string {
  const { display, colors } = ctx.config;
  const percent = getContextPercent(ctx.payload);
  const thresholds = { warning: display.contextWarningThreshold, critical: display.contextCriticalThreshold };
  const value = `${contextColor(percent, colors, thresholds)}${formatContextValue(ctx, percent)}${RESET}`;
  const head = label(hudLabel("context"), colors);
  const line = display.showContextBar
    ? `${head} ${contextBar(percent, adaptiveBarWidth(width), colors, thresholds)} ${value}`
    : `${head} ${value}`;
  return line + tokenBreakdown(ctx, percent);
}

function formatRelative(diffMs: number): string {
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const rem = hours % 24;
    return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
  }
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatAbsolute(at: Date, now: Date): string {
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const prefix = hudLabel("at");
  const stamp = at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  return prefix ? `${prefix} ${stamp}` : stamp;
}

export function formatResetTime(resetAt: Date | null, mode: "relative" | "absolute" | "both", now: number): string {
  if (!resetAt) return "";
  const diff = resetAt.getTime() - now;
  if (diff <= 0) return "";
  if (mode === "relative") return formatRelative(diff);
  const absolute = formatAbsolute(resetAt, new Date(now));
  return mode === "absolute" ? absolute : `${formatRelative(diff)}, ${absolute}`;
}

function usagePercentText(ctx: HudContext, percent: number | null): string {
  const { display, colors } = ctx.config;
  if (percent === null) return label("--", colors);
  const shown = display.usageValue === "remaining" ? Math.max(0, 100 - percent) : percent;
  return `${quotaColor(percent, colors)}${shown}%${RESET}`;
}

interface UsageWindowOptions {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  /** 상대 시각 모드에서 바 뒤에 "(2h 30m / 5h)" 로 붙는 창 길이 라벨. */
  durationLabel: string;
  forceLabel: boolean;
}

function usageWindow(ctx: HudContext, width: number | null, o: UsageWindowOptions): string {
  const { display, colors } = ctx.config;
  const value = usagePercentText(ctx, o.percent);
  const reset = formatResetTime(o.resetAt, display.timeFormat, ctx.now);
  const resetsKey = display.timeFormat === "absolute" ? "resets" : "resetsIn";
  const styled = label(o.label, colors);
  if (display.usageCompact) {
    return reset ? `${label(`${o.label}:`, colors)} ${value} ${label(`(${reset})`, colors)}` : `${label(`${o.label}:`, colors)} ${value}`;
  }
  const suffix = reset ? (display.showResetLabel ? ` (${hudLabel(resetsKey)} ${reset})` : ` (${reset})`) : "";
  if (display.usageBarEnabled) {
    const body = `${quotaBar(o.percent ?? 0, adaptiveBarWidth(width), colors)} ${value}${suffix}`;
    return o.forceLabel ? `${styled} ${body}` : body;
  }
  return `${styled} ${value}${suffix}`;
}

/** usage 창들을 부분 문자열 배열로 — expanded는 한 줄로 잇고, compact 세션 줄은 개별 세그먼트로 쓴다. */
function usageParts(ctx: HudContext, width: number | null): string[] {
  const { display, colors } = ctx.config;
  if (!display.showUsage) return [];
  const usage: UsageData | null = getUsage(ctx.payload);
  if (!usage) return [];

  const usageHead = label(hudLabel("usage"), colors);
  const scoped = display.showModelScopedUsage ? usage.scopedWindows : [];
  const scopedParts = scoped.map((w) =>
    usageWindow(ctx, width, { label: w.label, percent: w.percent, resetAt: w.resetAt, durationLabel: "7d", forceLabel: true }),
  );

  if (usage.fiveHour === 100 || usage.sevenDay === 100) {
    const resetAt = usage.fiveHour === 100 ? usage.fiveHourResetAt : usage.sevenDayResetAt;
    const reset = formatResetTime(resetAt, display.timeFormat, ctx.now);
    const resetsKey = display.timeFormat === "absolute" ? "resets" : "resetsIn";
    const suffix = reset ? (display.showResetLabel && !display.usageCompact ? ` (${hudLabel(resetsKey)} ${reset})` : ` (${reset})`) : "";
    return [`${usageHead} ${critical(`⚠ ${hudLabel("limitReached")}${suffix}`, colors)}`, ...scopedParts];
  }

  const effective = Math.max(usage.fiveHour ?? 0, usage.sevenDay ?? 0, ...scoped.map((w) => w.percent ?? 0));
  if (effective < display.usageThreshold) return [];

  const parts: string[] = [];
  if (usage.fiveHour === null && usage.sevenDay !== null) {
    parts.push(`${usageHead} ${usageWindow(ctx, width, { label: hudLabel("weekly"), percent: usage.sevenDay, resetAt: usage.sevenDayResetAt, durationLabel: "7d", forceLabel: true })}`);
  } else if (usage.fiveHour !== null) {
    parts.push(`${usageHead} ${usageWindow(ctx, width, { label: "5h", percent: usage.fiveHour, resetAt: usage.fiveHourResetAt, durationLabel: "5h", forceLabel: false })}`);
    if (usage.sevenDay !== null && usage.sevenDay >= display.sevenDayThreshold) {
      parts.push(usageWindow(ctx, width, { label: hudLabel("weekly"), percent: usage.sevenDay, resetAt: usage.sevenDayResetAt, durationLabel: "7d", forceLabel: true }));
    }
  }
  if (parts.length === 0 && scopedParts.length > 0) {
    parts.push(`${usageHead} ${scopedParts[0]}`, ...scopedParts.slice(1));
  } else {
    parts.push(...scopedParts);
  }
  return parts;
}

function renderUsageLine(ctx: HudContext, width: number | null): string | null {
  const parts = usageParts(ctx, width);
  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * 마지막 요청의 캐시 히트율 = cache_read / (input + cache_creation + cache_read).
 * 캐시가 만료돼 새로 쓴 턴에서는 뚝 떨어지므로 세션 누적치보다 캐시 상태를 빨리 드러낸다.
 */
export function cacheHitRate(usage: SessionTokenUsage | undefined): number | null {
  if (!usage) return null;
  const total = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  if (total <= 0) return null;
  return Math.round((usage.cacheReadTokens / total) * 100);
}

function cacheHitSegment(ctx: HudContext): string {
  const { display, colors } = ctx.config;
  if (!display.showCacheHitRate) return "";
  const rate = cacheHitRate(ctx.transcript.lastRequestUsage);
  if (rate === null) return "";
  const value = `${rate}%`;
  const colored = rate >= 80 ? green(value) : rate >= 50 ? warning(value, colors) : critical(value, colors);
  return ` ${label("·", colors)} ${label(hudLabel("hit"), colors)} ${colored}`;
}

/**
 * prompt cache 만료 시각. 카운트다운이 아닌 시각인 이유: statusline은 Claude가 활동할 때만
 * 다시 그려져서, 턴 사이(캐시가 실제로 빠지는 동안)에는 남은 시간이 멈춘 채 보이기 때문이다.
 * 만료 전 TTL/5(최소 60초)부터 경고색, 지나면 "expired". 뒤에 마지막 요청의 히트율이 붙는다.
 */
function renderPromptCacheLine(ctx: HudContext): string | null {
  const { display, colors } = ctx.config;
  const anchor = ctx.transcript.promptCacheAnchorAt;
  if (anchor === undefined || !Number.isFinite(anchor)) return null;
  const ttl = ctx.transcript.promptCacheTtlSeconds ?? display.promptCacheTtlSeconds;
  const expiresAt = anchor + ttl * 1000;
  const remaining = expiresAt - ctx.now;
  const warnMs = Math.min(ttl, Math.max(60, Math.floor(ttl / 5))) * 1000;
  const head = label(hudLabel("promptCache"), colors);
  const hit = cacheHitSegment(ctx);
  if (remaining <= 0) return `${head} ${label(`⏱ ${hudLabel("expired")}`, colors)}${hit}`;
  const value = `⏱ ${hudLabel("until")} ${formatAbsolute(new Date(expiresAt), new Date(ctx.now)).replace(/^at /, "")}`;
  const thresholds = { warning: display.contextWarningThreshold, critical: display.contextCriticalThreshold };
  const colored = remaining <= warnMs ? warning(value, colors) : `${contextColor(0, colors, thresholds)}${value}${RESET}`;
  return `${head} ${colored}${hit}`;
}

function renderMemoryLine(ctx: HudContext, width: number | null): string | null {
  const { colors } = ctx.config;
  const memory = ctx.memory;
  if (!memory) return null;
  const percent = `${quotaColor(memory.usedPercent, colors)}${memory.usedPercent}%${RESET}`;
  return `${label(hudLabel("approxRam"), colors)} ${quotaBar(memory.usedPercent, adaptiveBarWidth(width), colors)} ${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)} (${percent})`;
}

// ---------------------------------------------------------------- session totals

export function sessionTokenSummary(tokens: SessionTokenUsage | undefined, prefix: string): string | null {
  if (!tokens) return null;
  const total = tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  if (total === 0) return null;
  const parts = [`${hudLabel("in")}: ${formatTokens(tokens.inputTokens)}`, `${hudLabel("out")}: ${formatTokens(tokens.outputTokens)}`];
  if (tokens.cacheCreationTokens > 0 || tokens.cacheReadTokens > 0) {
    parts.push(`${hudLabel("cache")}: ${formatTokens(tokens.cacheCreationTokens + tokens.cacheReadTokens)}`);
  }
  return `${prefix} ${formatTokens(total)} (${parts.join(", ")})`;
}

function renderSessionTokensLine(ctx: HudContext): string | null {
  const { display, colors } = ctx.config;
  if (!display.showSessionTokens) return null;
  const summary = sessionTokenSummary(ctx.transcript.sessionTokens, hudLabel("tokens"));
  return summary ? label(summary, colors) : null;
}

function renderCompactionsLine(ctx: HudContext): string | null {
  const { display, colors } = ctx.config;
  const count = ctx.transcript.compactionCount ?? 0;
  if (!display.showCompactions || count === 0) return null;
  return label(`${hudLabel("compactions")}: ${count}`, colors);
}

// ---------------------------------------------------------------- activity lines

function shortenToolName(name: string, maxLen: number): string {
  const display = /^mcp__.+__.+$/.test(name) ? (name.split("__").pop() ?? name) : name;
  if (maxLen === 0 || display.length <= maxLen) return display;
  return `${display.slice(0, Math.max(0, maxLen - 1))}…`;
}

function truncatePath(target: string, maxLen = 20): string {
  const normalized = target.replace(/\\/g, "/");
  if (normalized.length <= maxLen) return normalized;
  const base = path.posix.basename(normalized) || normalized;
  return base.length >= maxLen ? `${base.slice(0, maxLen - 3)}...` : `.../${base}`;
}

function renderToolsLine(ctx: HudContext): string | null {
  const { display, colors } = ctx.config;
  // Skills 줄이 켜져 있으면 Skill 호출은 그쪽에서 보여주므로 도구 줄에서는 뺀다.
  const tools = display.showSkills ? ctx.transcript.tools.filter((t) => t.name !== "Skill") : ctx.transcript.tools;
  if (tools.length === 0) return null;
  const parts: string[] = [];
  for (const tool of tools.filter((t) => t.status === "running").slice(-2)) {
    const target = tool.target ? label(`: ${truncatePath(tool.target)}`, colors) : "";
    parts.push(`${yellow("◐")} ${cyan(shortenToolName(tool.name, display.toolNameMaxLength))}${target}`);
  }
  const counts = new Map<string, number>();
  for (const tool of tools) {
    if (tool.status === "running") continue;
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const visible = display.toolsMaxVisible === 0 ? sorted : sorted.slice(0, display.toolsMaxVisible);
  for (const [name, count] of visible) {
    parts.push(`${green("✓")} ${shortenToolName(name, display.toolNameMaxLength)} ${label(`×${count}`, colors)}`);
  }
  const hidden = sorted.length - visible.length;
  if (hidden > 0) parts.push(label(`+${hidden} ${hudLabel("more")}`, colors));
  return parts.length > 0 ? parts.join(" | ") : null;
}

function renderSkillsLine(ctx: HudContext): string | null {
  const { colors } = ctx.config;
  const skills = ctx.transcript.skills;
  if (skills.length === 0) return null;
  const visible = skills.slice(0, 4).map((name) => cyan(name));
  const hidden = skills.length - visible.length;
  if (hidden > 0) visible.push(label(`+${hidden} ${hudLabel("more")}`, colors));
  return `${green("✓")} ${hudLabel("skills")} ${label(`(${skills.length})`, colors)}: ${visible.join(", ")}`;
}

/** "claude-opus-4-8[1m]" → "opus-4.8" 처럼 statusline에 맞게 줄인다. 모르는 형태는 그대로. */
export function formatAgentModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const candidate = model.replace(/\[[^\]]*\]$/, "");
  const current = candidate.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-\d{8})?$/i);
  if (current) return `${current[1].toLowerCase()}-${current[2]}${current[3] ? `.${current[3]}` : ""}`;
  const legacy = candidate.match(/^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)(?:-\d{8})?$/i);
  if (legacy) return `${legacy[3].toLowerCase()}-${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ""}`;
  return model;
}

function formatElapsed(agent: AgentEntry, now: number): string {
  const ms = Math.max(0, (agent.endTime ?? now) - agent.startTime);
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  if (mins < 60) return `${mins}m ${totalSecs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function renderAgentsLine(ctx: HudContext): string | null {
  const { colors } = ctx.config;
  const { agents } = ctx.transcript;
  const running = agents.filter((a) => a.status === "running").slice(-3);
  const completedSlots = Math.min(2, 3 - running.length);
  const completed = agents
    .filter((a) => a.status === "completed" && a.endTime !== undefined && a.endTime <= ctx.now && ctx.now - a.endTime <= COMPLETED_AGENT_RETENTION_MS)
    .slice(-completedSlots);
  const shown = [...running, ...(completedSlots > 0 ? completed : [])];
  if (shown.length === 0) return null;
  return shown
    .map((agent) => {
      const icon = agent.status === "running" ? yellow("◐") : green("✓");
      const model = formatAgentModel(agent.model);
      const modelPart = model ? ` ${label(`[${model}]`, colors)}` : "";
      const desc = agent.description ? label(`: ${agent.description}`, colors) : "";
      return `${icon} ${magenta(agent.type)}${modelPart}${desc} ${label(`(${formatElapsed(agent, ctx.now)})`, colors)}`;
    })
    .join("\n");
}

function renderTodosLine(ctx: HudContext): string | null {
  const { colors } = ctx.config;
  const { todos } = ctx.transcript;
  if (todos.length === 0) return null;
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const progress = label(`(${completed}/${todos.length})`, colors);
  if (!inProgress) {
    return completed === todos.length ? `${green("✓")} ${hudLabel("allTodosComplete")} ${progress}` : null;
  }
  const content = inProgress.content.length > 50 ? `${inProgress.content.slice(0, 47)}...` : inProgress.content;
  return `${yellow("▸")} ${content} ${progress}`;
}

// ---------------------------------------------------------------- git files line

function resolveWithinCwd(cwd: string, candidate: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(path.resolve(cwd), resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved : null;
}

/** 마지막 줄: 최근 수정순 변경 파일 6개 (`~name(+a -d)  +name  -name  +N more  ?N`). 60칸 미만이면 숨긴다. */
function renderGitFilesLine(ctx: HudContext, width: number | null): string | null {
  const { gitStatus: cfg } = ctx.config;
  const stats = ctx.gitStatus?.fileStats;
  if (!cfg.enabled || !cfg.showFileStats || !stats) return null;
  if (stats.trackedFiles.length === 0 && stats.untracked === 0) return null;
  if (width !== null && width < 60) return null;

  const cwd = currentDir(ctx);
  const mtime = (file: string): number => {
    try {
      const resolved = cwd ? resolveWithinCwd(cwd, file) : null;
      return resolved ? fs.statSync(resolved).mtimeMs : 0;
    } catch {
      return 0;
    }
  };
  const sorted = [...stats.trackedFiles].sort((a, b) => mtime(b.fullPath) - mtime(a.fullPath));
  const shown = sorted.slice(0, 6);
  const parts: string[] = [];
  for (const file of shown) {
    const name = sanitizeText(file.basename, 64);
    const prefix = file.type === "added" ? green("+") : file.type === "deleted" ? red("-") : yellow("~");
    const colored = file.type === "added" ? green(name) : file.type === "deleted" ? red(name) : yellow(name);
    const resolved = cwd ? resolveWithinCwd(cwd, file.fullPath) : null;
    let entry = `${prefix}${resolved ? safeHyperlink(fileHref(resolved), colored) : colored}`;
    if (file.lineDiff) {
      const diff: string[] = [];
      if (file.lineDiff.added > 0) diff.push(green(`+${file.lineDiff.added}`));
      if (file.lineDiff.deleted > 0) diff.push(red(`-${file.lineDiff.deleted}`));
      if (diff.length > 0) entry += dim(`(${diff.join(" ")})`);
    }
    parts.push(entry);
  }
  const overflow = sorted.length - shown.length;
  if (overflow > 0) parts.push(dim(`+${overflow} ${hudLabel("more")}`));
  if (stats.untracked > 0) parts.push(dim(`?${stats.untracked}`));
  return parts.join("  ");
}
