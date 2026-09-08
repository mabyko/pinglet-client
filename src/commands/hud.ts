import { loadConfig, saveConfig } from "../config";
import {
  DEFAULT_HUD_CONFIG,
  FirstLineSegment,
  HudConfig,
  HudElement,
  HudPreset,
  KNOWN_ELEMENTS,
  KNOWN_FIRST_LINE_SEGMENTS,
  TOGGLE_KEYS,
  applyPreset,
  normalizeHudConfig,
  setToggle,
} from "../hud/config";
import { renderHudLines } from "../hud";
import { StatuslinePayload } from "../hud/stdin";
import { t } from "../i18n";

/**
 * `pinglet hud` — statusline HUD 설정.
 * claude-hud의 configure 흐름(프리셋 → 끄기/켜기 → 레이아웃)을 플래그로 옮겼다.
 * 인자 없이 실행하면 현재 설정과 미리보기를 보여준다. `/pinglet-hud`에서도 같은 인자를 받는다.
 */
const PRESETS: readonly HudPreset[] = ["full", "essential", "minimal"];

interface ParsedArgs {
  preset?: HudPreset;
  layout?: "compact" | "expanded";
  show: string[];
  hide: string[];
  order?: HudElement[];
  firstLine?: FirstLineSegment[];
  pathLevels?: HudConfig["pathLevels"];
  separators?: boolean;
  git?: boolean;
  enabled?: boolean;
  reset: boolean;
  errors: string[];
}

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
}

function onOff(value: string | undefined): boolean | undefined {
  if (value === "on" || value === "true" || value === "1") return true;
  if (value === "off" || value === "false" || value === "0") return false;
  return undefined;
}

/** 값을 하나 더 받는 플래그 — 그 뒤 토큰은 값이므로 플래그로 승격하지 않는다. */
const VALUE_FLAGS = new Set([
  "--preset", "--layout", "--show", "--hide", "--order", "--first-line", "--path-levels", "--separators", "--git",
]);
const FLAG_NAMES = new Set([
  "preset", "layout", "show", "hide", "order", "first-line", "path-levels", "separators", "git", "on", "off", "reset",
]);
const LAYOUTS = new Set(["compact", "expanded"]);

/**
 * `--`를 생략한 형태를 받아 준다 — 슬래시 명령(`/pinglet-hud essential`)에서 대시를 붙이는 게
 * 부자연스럽기 때문이다. `essential` → `--preset essential`, `preset essential` → `--preset essential`,
 * `compact` → `--layout compact`. 값 자리(예: `--git off`)의 토큰은 그대로 둔다.
 */
export function normalizeHudArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const previous = out[out.length - 1];
    if (previous !== undefined && VALUE_FLAGS.has(previous)) {
      out.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      out.push(arg);
      continue;
    }
    const bare = arg.replace(/^-+/, "").toLowerCase();
    if (FLAG_NAMES.has(bare)) out.push(`--${bare}`);
    else if ((PRESETS as readonly string[]).includes(bare)) out.push("--preset", bare);
    else if (LAYOUTS.has(bare)) out.push("--layout", bare);
    else out.push(arg);
  }
  return out;
}

export function parseHudArgs(rawArgs: string[]): ParsedArgs {
  const args = normalizeHudArgs(rawArgs);
  const parsed: ParsedArgs = { show: [], hide: [], reset: false, errors: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    switch (arg) {
      case "--preset": {
        const value = next();
        if ((PRESETS as readonly string[]).includes(value)) parsed.preset = value as HudPreset;
        else parsed.errors.push(t("hud.badPreset", { value: value ?? "" }));
        break;
      }
      case "--layout": {
        const value = next();
        if (value === "compact" || value === "expanded") parsed.layout = value;
        else parsed.errors.push(t("hud.badLayout", { value: value ?? "" }));
        break;
      }
      case "--show":
      case "--hide": {
        const list = splitList(next());
        for (const item of list) {
          if (!TOGGLE_KEYS[item]) parsed.errors.push(t("hud.badToggle", { value: item }));
          else (arg === "--show" ? parsed.show : parsed.hide).push(item);
        }
        break;
      }
      case "--order": {
        const list = splitList(next());
        const bad = list.filter((item) => !KNOWN_ELEMENTS.has(item as HudElement));
        if (bad.length > 0 || list.length === 0) parsed.errors.push(t("hud.badOrder", { value: bad.join(", ") }));
        else parsed.order = list as HudElement[];
        break;
      }
      case "--first-line": {
        const list = splitList(next());
        const bad = list.filter((item) => !KNOWN_FIRST_LINE_SEGMENTS.has(item as FirstLineSegment));
        if (bad.length > 0) parsed.errors.push(t("hud.badFirstLine", { value: bad.join(", ") }));
        else parsed.firstLine = list as FirstLineSegment[];
        break;
      }
      case "--path-levels": {
        const value = next();
        if (value === "full") parsed.pathLevels = "full";
        else if (value === "1" || value === "2" || value === "3") parsed.pathLevels = Number(value) as 1 | 2 | 3;
        else parsed.errors.push(t("hud.badPathLevels", { value: value ?? "" }));
        break;
      }
      case "--separators": {
        const value = onOff(next());
        if (value === undefined) parsed.errors.push(t("hud.badOnOff", { flag: arg }));
        else parsed.separators = value;
        break;
      }
      case "--git": {
        const value = onOff(next());
        if (value === undefined) parsed.errors.push(t("hud.badOnOff", { flag: arg }));
        else parsed.git = value;
        break;
      }
      case "--on":
        parsed.enabled = true;
        break;
      case "--off":
        parsed.enabled = false;
        break;
      case "--reset":
        parsed.reset = true;
        break;
      case "--quiet":
        // cli가 이미 걸러 내지만, 사용자가 직접 넘긴 경우에도 오류로 만들지 않는다.
        break;
      default:
        parsed.errors.push(t("hud.unknownArg", { value: arg }));
    }
  }
  return parsed;
}

export function applyHudArgs(current: HudConfig, parsed: ParsedArgs): HudConfig {
  let hud = parsed.reset ? structuredClone(DEFAULT_HUD_CONFIG) : structuredClone(current);
  if (parsed.preset) hud = applyPreset(hud, parsed.preset);
  if (parsed.layout) hud.lineLayout = parsed.layout;
  for (const item of parsed.show) setToggle(hud, item, true);
  for (const item of parsed.hide) setToggle(hud, item, false);
  if (parsed.order) hud.elementOrder = parsed.order;
  if (parsed.firstLine) hud.projectLineOrder = parsed.firstLine;
  if (parsed.pathLevels) hud.pathLevels = parsed.pathLevels;
  if (parsed.separators !== undefined) hud.showSeparators = parsed.separators;
  if (parsed.git !== undefined) hud.gitStatus.enabled = parsed.git;
  if (parsed.enabled !== undefined) hud.enabled = parsed.enabled;
  return normalizeHudConfig(hud);
}

/** 미리보기용 가짜 payload — 실제 세션 값이 아니라 설정이 어떻게 보이는지만 확인한다. */
const PREVIEW_PAYLOAD: StatuslinePayload = {
  model: { id: "claude-opus-5", display_name: "Opus 5" },
  cwd: process.cwd(),
  context_window: { context_window_size: 200_000, used_percentage: 45, current_usage: { input_tokens: 80_000, output_tokens: 10_000 } },
  cost: { total_cost_usd: 0.42, total_duration_ms: 300_000, total_api_duration_ms: 120_000 },
  rate_limits: {
    five_hour: { used_percentage: 25, resets_at: Math.floor(Date.now() / 1000) + 5400 },
    seven_day: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 3 * 86_400 },
  },
};

function summary(hud: HudConfig): string {
  const on = Object.entries(TOGGLE_KEYS)
    .filter(([, key], index, all) => all.findIndex(([, k]) => k === key) === index)
    .filter(([, key]) => {
      const [section, field] = key.split(".") as ["display" | "gitStatus", string];
      return (hud[section] as unknown as Record<string, unknown>)[field] === true;
    })
    .map(([name]) => name);
  return [
    `  enabled:     ${hud.enabled ? "on" : "off"}`,
    `  layout:      ${hud.lineLayout}${hud.showSeparators ? " (+separators)" : ""}`,
    `  order:       ${hud.elementOrder.join(", ")}`,
    `  first line:  ${hud.projectLineOrder.length > 0 ? hud.projectLineOrder.join(", ") : "(default)"}`,
    `  path levels: ${hud.pathLevels}`,
    `  git:         ${hud.gitStatus.enabled ? "on" : "off"}`,
    `  shown:       ${on.join(", ")}`,
  ].join("\n");
}

export async function runHud(args: string[], options: { quiet?: boolean } = {}): Promise<void> {
  const config = loadConfig();
  const current = normalizeHudConfig(config.hud);
  const parsed = parseHudArgs(args);
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) console.log(`✗ ${error}`);
    console.log(t("hud.usage"));
    process.exitCode = 1;
    return;
  }

  const changed = args.length > 0;
  const next = changed ? applyHudArgs(current, parsed) : current;
  if (changed) {
    config.hud = next;
    saveConfig(config);
  }

  if (options.quiet) {
    console.log(changed ? t("hud.savedQuiet", { layout: next.lineLayout, enabled: next.enabled ? "on" : "off" }) : summary(next).replace(/\n/g, " ·").replace(/\s+/g, " ").trim());
    return;
  }

  console.log("");
  console.log(changed ? t("hud.saved") : t("hud.current"));
  console.log(summary(next));
  console.log("");
  console.log(t("hud.preview"));
  const lines = await renderHudLines(next, PREVIEW_PAYLOAD);
  if (lines.length === 0) console.log(`  ${t("hud.previewEmpty")}`);
  for (const line of lines) console.log(`  ${line}`);
  console.log("");
  if (!changed) console.log(t("hud.usage"));
}
