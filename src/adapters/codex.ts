import * as fs from "fs";
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

function findNotifyLine(toml: string): string | null {
  const match = toml.match(/^\s*notify\s*=.*$/m);
  return match ? match[0] : null;
}

export function isCodexIntegrationInstalled(): boolean {
  const line = findNotifyLine(readToml());
  return (
    line !== null && (line.includes("pinglet") || line.includes(cliPath()))
  );
}

export function installCodexIntegration(
  config: PingletConfig,
  options: { force?: boolean } = {},
): { ok: boolean; reason?: string } {
  const toml = readToml();
  const existing = findNotifyLine(toml);
  const isOurs =
    existing !== null &&
    (existing.includes("pinglet") || existing.includes(cliPath()));

  if (existing && !isOurs && !options.force) {
    return {
      ok: false,
      reason:
        "기존 notify 설정이 있습니다. 덮어쓰려면 --force로 다시 실행하세요.",
    };
  }

  config.adapters.codex = {
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
  const existing = findNotifyLine(toml);
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
