import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AgentType, InstallRecord } from "./types";

/** package.json의 version — 하드코딩하면 npm version bump와 어긋난다. */
export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export const PINGLET_DIR = path.join(os.homedir(), ".pinglet");
export const CONFIG_PATH = path.join(PINGLET_DIR, "config.json");
export const FEED_PATH = path.join(PINGLET_DIR, "feed.json");
export const STATE_PATH = path.join(PINGLET_DIR, "state.json");
export const EVENTS_PATH = path.join(PINGLET_DIR, "events.jsonl");

export const DEFAULT_API_BASE_URL =
  process.env.PINGLET_API_URL ?? "https://pinglet.halluci.co.kr";

export interface PingletConfig {
  apiBaseUrl: string;
  createdAt: string;
  userToken?: string;
  /** agent별 백엔드 installation 등록 정보 (POST /installations 응답) */
  installations: Partial<Record<AgentType, InstallRecord>>;
  adapters: {
    claude?: {
      installedAt: string;
      settingsPath: string;
      statusLineBackup?: unknown;
      /** 설치 전 사용자가 직접 쓰던 spinnerTipsOverride (구버전 흔적 정리 시 복원) */
      spinnerTipsBackup?: unknown;
      /** 설치 전 사용자가 직접 쓰던 spinnerVerbs (uninstall 시 복원) */
      spinnerVerbsBackup?: unknown;
    };
    codex?: {
      installedAt: string;
      configPath: string;
      notifyBackup?: string | null;
    };
  };
}

export function ensurePingletDir(): void {
  fs.mkdirSync(PINGLET_DIR, { recursive: true });
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensurePingletDir();
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

export function loadConfig(): PingletConfig {
  const existing = readJsonFile<PingletConfig>(CONFIG_PATH);
  if (existing) {
    existing.installations ??= {};
    existing.adapters ??= {};
    return existing;
  }
  const fresh: PingletConfig = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    createdAt: new Date().toISOString(),
    installations: {},
    adapters: {},
  };
  writeJsonFile(CONFIG_PATH, fresh);
  return fresh;
}

export function saveConfig(config: PingletConfig): void {
  writeJsonFile(CONFIG_PATH, config);
}

/**
 * CLI 엔트리(dist/cli.js)의 절대 경로. adapter command에 박아 넣는다.
 * argv[1] 대신 __dirname 기준으로 계산해 postinstall 등 다른 엔트리에서
 * 호출돼도 항상 cli.js를 가리킨다.
 */
export function cliPath(): string {
  return path.join(__dirname, "cli.js");
}
