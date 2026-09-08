import { HudColorName, HudColorValue, HudColors } from "./config";

export const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const ANSI_BY_NAME: Record<HudColorName, string> = {
  dim: DIM,
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
};

function resolveAnsi(value: HudColorValue | undefined, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "number") return `\x1b[38;5;${value}m`;
  if (typeof value === "string" && value.startsWith("#") && value.length === 7) {
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    return `\x1b[38;2;${r};${g};${b}m`;
  }
  return ANSI_BY_NAME[value as HudColorName] ?? fallback;
}

const colorize = (text: string, ansi: string): string => `${ansi}${text}${RESET}`;

export const green = (t: string) => colorize(t, ANSI_BY_NAME.green);
export const yellow = (t: string) => colorize(t, ANSI_BY_NAME.yellow);
export const red = (t: string) => colorize(t, ANSI_BY_NAME.red);
export const cyan = (t: string) => colorize(t, ANSI_BY_NAME.cyan);
export const magenta = (t: string) => colorize(t, ANSI_BY_NAME.magenta);
export const dim = (t: string) => colorize(t, DIM);

export const model = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.model, ANSI_BY_NAME.cyan));
export const project = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.project, ANSI_BY_NAME.yellow));
export const git = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.git, ANSI_BY_NAME.magenta));
export const gitBranch = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.gitBranch, ANSI_BY_NAME.cyan));
export const label = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.label, DIM));
export const warning = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.warning, ANSI_BY_NAME.yellow));
export const critical = (t: string, c: HudColors) => colorize(t, resolveAnsi(c.critical, ANSI_BY_NAME.red));

export interface ContextThresholds {
  warning: number;
  critical: number;
}

export function contextColor(percent: number, c: HudColors, thresholds: ContextThresholds): string {
  if (percent >= thresholds.critical) return resolveAnsi(c.critical, ANSI_BY_NAME.red);
  if (percent >= thresholds.warning) return resolveAnsi(c.warning, ANSI_BY_NAME.yellow);
  return resolveAnsi(c.context, ANSI_BY_NAME.green);
}

export function quotaColor(percent: number, c: HudColors): string {
  if (percent >= 90) return resolveAnsi(c.critical, ANSI_BY_NAME.red);
  if (percent >= 75) return resolveAnsi(c.usageWarning, ANSI_BY_NAME.brightMagenta);
  return resolveAnsi(c.usage, ANSI_BY_NAME.brightBlue);
}

function bar(percent: number, width: number, ansi: string, c: HudColors): string {
  const safeWidth = Math.max(0, Math.round(width));
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  return `${ansi}${c.barFilled.repeat(filled)}${DIM}${c.barEmpty.repeat(safeWidth - filled)}${RESET}`;
}

export const contextBar = (percent: number, width: number, c: HudColors, thresholds: ContextThresholds) =>
  bar(percent, width, contextColor(percent, c, thresholds), c);
export const quotaBar = (percent: number, width: number, c: HudColors) =>
  bar(percent, width, quotaColor(percent, c), c);
