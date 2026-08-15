import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { PingletConfig, cliPath, saveConfig } from "../config";
import { loadFeedMessages } from "../cache";
import { formatPing } from "../render";
import { FeedMessage } from "../types";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");

/**
 * Claude Adapter.
 * Claude Code의 statusLine hook에 `pinglet statusline`을 연결한다.
 * - statusline은 UI 영역이므로 LLM context에 전혀 들어가지 않는다 (Zero Token).
 * - Claude가 Thinking/Working 중일 때 status 영역에 Ping 메시지가 보인다.
 */
export function detectClaude(): boolean {
  if (fs.existsSync(CLAUDE_DIR)) return true;
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["claude"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function statusLineCommand(): string {
  return `node "${cliPath()}" statusline`;
}

interface SpinnerTipsOverride {
  excludeDefault?: boolean;
  tips: string[];
}

interface SpinnerVerbs {
  mode: "append" | "replace";
  verbs: string[];
}

interface ClaudeSettings {
  statusLine?: { type?: string; command?: string; [key: string]: unknown };
  spinnerTipsOverride?: SpinnerTipsOverride;
  spinnerVerbs?: SpinnerVerbs;
  [key: string]: unknown;
}

/** Pinglet이 쓴 항목인지 식별하는 마커. uninstall 시 사용자 것과 구분한다. */
const PINGLET_TIP_MARKER = "​"; // zero-width space (항목 앞에 붙임)
const MAX_VERBS = 30;
/** spinner 한 줄에 "(27s · ↓ 1.0k tokens)" 등이 뒤에 붙으므로 여유를 둔다. */
const MAX_VERB_LEN = 60;

function readSettings(): ClaudeSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettings): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  // settings.json은 Claude Code가 수시로 읽는 파일이라 tmp+rename으로 원자적으로 쓴다.
  const tmp = SETTINGS_PATH + ".pinglet-tmp";
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  fs.renameSync(tmp, SETTINGS_PATH);
}

function isPingletTip(tip: string): boolean {
  return tip.startsWith(PINGLET_TIP_MARKER);
}

function buildPingletVerbs(messages: FeedMessage[]): string[] {
  return messages.slice(0, MAX_VERBS).map((message) => {
    let line = formatPing(message);
    if (line.length > MAX_VERB_LEN) {
      line = line.slice(0, MAX_VERB_LEN - 1) + "…";
    }
    return PINGLET_TIP_MARKER + line;
  });
}

/**
 * 예전 버전이 spinnerTipsOverride에 등록해 둔 Pinglet tips를 정리한다.
 * (tips는 "└ Tip: ..." 줄로 그려져서 verb 교체 방식으로 옮겼다.)
 */
function cleanupSpinnerTips(
  settings: ClaudeSettings,
  config: PingletConfig,
): boolean {
  const override = settings.spinnerTipsOverride;
  if (!override?.tips?.some(isPingletTip)) return false;

  const adapter = config.adapters.claude;
  const backup = adapter?.spinnerTipsBackup;
  const userTips = override.tips.filter((tip) => !isPingletTip(tip));
  if (backup) {
    settings.spinnerTipsOverride = backup as SpinnerTipsOverride;
  } else if (userTips.length > 0) {
    settings.spinnerTipsOverride = { ...override, tips: userTips };
  } else {
    delete settings.spinnerTipsOverride;
  }
  if (adapter?.spinnerTipsBackup !== undefined) {
    delete adapter.spinnerTipsBackup;
    saveConfig(config);
  }
  return true;
}

/**
 * Claude Code spinner verb("Befuddling…" 자리)를 feed 메시지로 교체한다.
 * mode: "replace"라 기본 verb 대신 Ping이 그대로 spinner 본문에 표시된다.
 * 마커가 붙은 항목만 Pinglet 소유로 보고 교체하며, 사용자 verb는 유지한다.
 */
export function syncSpinnerVerbs(
  config: PingletConfig,
  messages: FeedMessage[],
): boolean {
  const adapter = config.adapters.claude;
  if (!adapter) return false;

  const settings = readSettings();
  cleanupSpinnerTips(settings, config);

  const existing = settings.spinnerVerbs;
  const existingVerbs = existing?.verbs ?? [];

  // 사용자가 원래 갖고 있던 spinnerVerbs는 최초 1회 백업해 두고 uninstall 시 복원한다.
  const isOurs = existingVerbs.some(isPingletTip);
  if (existing && !isOurs && adapter.spinnerVerbsBackup === undefined) {
    adapter.spinnerVerbsBackup = existing;
    saveConfig(config);
  }

  const userVerbs = existingVerbs.filter((verb) => !isPingletTip(verb));
  settings.spinnerVerbs = {
    mode: "replace",
    verbs: [...userVerbs, ...buildPingletVerbs(messages)],
  };
  writeSettings(settings);
  return true;
}

/** doctor용: spinner verb로 등록된 Pinglet 메시지 개수. */
export function spinnerVerbsStatus(): { count: number } {
  const settings = readSettings();
  const verbs = settings.spinnerVerbs?.verbs ?? [];
  return { count: verbs.filter(isPingletTip).length };
}

export function isClaudeIntegrationInstalled(): boolean {
  const settings = readSettings();
  return settings.statusLine?.command?.includes("pinglet") ?? false;
}

export function installClaudeIntegration(
  config: PingletConfig,
  options: { force?: boolean } = {},
): { ok: boolean; reason?: string } {
  const settings = readSettings();
  const existing = settings.statusLine;

  const isOurs = existing?.command?.includes("pinglet");
  if (existing && !isOurs && !options.force) {
    return {
      ok: false,
      reason:
        "기존 statusLine 설정이 있습니다. 덮어쓰려면 --force로 다시 실행하세요.",
    };
  }

  config.adapters.claude = {
    installedAt: new Date().toISOString(),
    settingsPath: SETTINGS_PATH,
    // 사용자의 기존 설정은 백업해 두고 uninstall 시 복원한다.
    ...(existing && !isOurs && { statusLineBackup: existing }),
  };
  saveConfig(config);

  settings.statusLine = { type: "command", command: statusLineCommand() };
  writeSettings(settings);

  // spinner verb는 우선 로컬 캐시(시드 포함)로 채우고, 이후 refresh가 서버 feed로 갱신한다.
  syncSpinnerVerbs(config, loadFeedMessages());
  return { ok: true };
}

export function uninstallClaudeIntegration(config: PingletConfig): boolean {
  const settings = readSettings();
  let changed = false;

  if (settings.statusLine?.command?.includes("pinglet")) {
    const backup = config.adapters.claude?.statusLineBackup;
    if (backup) {
      settings.statusLine = backup as ClaudeSettings["statusLine"];
    } else {
      delete settings.statusLine;
    }
    changed = true;
  }

  if (cleanupSpinnerTips(settings, config)) {
    changed = true;
  }

  const verbs = settings.spinnerVerbs;
  if (verbs?.verbs?.some(isPingletTip)) {
    const verbsBackup = config.adapters.claude?.spinnerVerbsBackup;
    const userVerbs = verbs.verbs.filter((verb) => !isPingletTip(verb));
    if (verbsBackup) {
      settings.spinnerVerbs = verbsBackup as SpinnerVerbs;
    } else if (userVerbs.length > 0) {
      settings.spinnerVerbs = { ...verbs, verbs: userVerbs };
    } else {
      delete settings.spinnerVerbs;
    }
    changed = true;
  }

  if (changed) {
    writeSettings(settings);
  }
  if (config.adapters.claude) {
    delete config.adapters.claude;
    saveConfig(config);
  }
  return changed;
}
