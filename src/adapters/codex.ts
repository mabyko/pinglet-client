import * as fs from "fs";
import { t } from "../i18n";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { PingletConfig, cliPath, saveConfig } from "../config";

const CODEX_DIR = path.join(os.homedir(), ".codex");
const CONFIG_TOML_PATH = path.join(CODEX_DIR, "config.toml");

/**
 * Codex Adapter (experimental).
 * Codex CLI의 notify hook에 `pinglet notify`를 연결한다.
 * notify는 터미널 UI 밖에서 실행되는 프로세스라 TUI 안에 직접 그릴 수 없어,
 * MVP에서는 turn 완료 시 OS 알림(macOS notification)으로 Ping을 전달한다.
 */
export function detectCodex(): boolean {
  if (fs.existsSync(CODEX_DIR)) return true;
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["codex"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function notifyLine(): string {
  return `notify = ["node", ${JSON.stringify(cliPath())}, "notify"]`;
}

function readToml(): string {
  try {
    return fs.readFileSync(CONFIG_TOML_PATH, "utf8");
  } catch {
    return "";
  }
}

/**
 * config.toml에서 notify 항목 **전체**를 찾는다. TOML 배열은 여러 줄에
 * 걸칠 수 있으므로 (Codex Computer Use 앱 등이 그렇게 쓴다) 값이 `[`로
 * 시작하면 문자열 리터럴을 건너뛰며 짝이 맞는 `]`까지를 항목으로 본다.
 * 한 줄만 매칭하면 교체/삭제 시 배열 본문이 고아로 남아 TOML이 깨진다.
 */
function findNotifyEntry(toml: string): string | null {
  const head = toml.match(/^[ \t]*notify[ \t]*=[ \t]*/m);
  if (!head || head.index === undefined) return null;
  const start = head.index;
  let i = start + head[0].length;

  if (toml[i] !== "[") {
    const lineEnd = toml.indexOf("\n", i);
    return toml.slice(start, lineEnd === -1 ? toml.length : lineEnd);
  }

  let depth = 0;
  for (; i < toml.length; i++) {
    const ch = toml[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < toml.length && toml[i] !== quote) {
        if (quote === '"' && toml[i] === "\\") i++; // basic string escape
        i++;
      }
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return toml.slice(start, i + 1);
    }
  }
  // 괄호 짝이 안 맞음 — 이미 깨진 파일이므로 건드리지 않는다.
  return null;
}

export function isCodexIntegrationInstalled(): boolean {
  const entry = findNotifyEntry(readToml());
  return (
    entry !== null && (entry.includes("pinglet") || entry.includes(cliPath()))
  );
}

export function installCodexIntegration(
  config: PingletConfig,
  options: { force?: boolean } = {},
): { ok: boolean; reason?: string; needsForce?: boolean } {
  const toml = readToml();
  const existing = findNotifyEntry(toml);
  const isOurs =
    existing !== null &&
    (existing.includes("pinglet") || existing.includes(cliPath()));

  if (existing && !isOurs && !options.force) {
    return {
      ok: false,
      needsForce: true,
      reason: t("codex.existingNotify"),
    };
  }

  config.adapters.codex = {
    // 재설치 시 기존 백업(notifyBackup)이 날아가지 않게 유지한다.
    ...config.adapters.codex,
    installedAt: new Date().toISOString(),
    configPath: CONFIG_TOML_PATH,
    ...(existing && !isOurs && { notifyBackup: existing }),
  };
  saveConfig(config);

  let next: string;
  if (existing) {
    next = toml.replace(existing, notifyLine());
  } else {
    // TOML top-level 키는 첫 [table] 이전에 있어야 하므로 파일 맨 앞에 넣는다.
    next = notifyLine() + "\n" + toml;
  }
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_TOML_PATH, next);
  return { ok: true };
}

export function uninstallCodexIntegration(config: PingletConfig): boolean {
  const toml = readToml();
  const existing = findNotifyEntry(toml);
  const isOurs =
    existing !== null &&
    (existing.includes("pinglet") || existing.includes(cliPath()));
  if (!existing || !isOurs) return false;

  const backup = config.adapters.codex?.notifyBackup;
  const next = backup
    ? toml.replace(existing, backup)
    : toml.replace(existing + "\n", "").replace(existing, "");
  fs.writeFileSync(CONFIG_TOML_PATH, next);
  delete config.adapters.codex;
  saveConfig(config);
  return true;
}
