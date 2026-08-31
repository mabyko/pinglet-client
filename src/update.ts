import { execFile, spawn } from "child_process";
import * as path from "path";
import {
  PingletConfig,
  UPDATE_PATH,
  VERSION,
  cliPath,
  readJsonFile,
  writeJsonFile,
} from "./config";

const REGISTRY_LATEST_URL = "https://registry.npmjs.org/pinglet-cli/latest";
const CHECK_INTERVAL_MS = 24 * 3600_000; // 하루 1회 확인
const RETRY_INTERVAL_MS = 7 * 24 * 3600_000; // 같은 버전 재시도는 주 1회

/** update.json — 자동 업데이트 진행 기록. state.json은 statusline과 쓰기 경합이 있어 분리한다. */
interface UpdateState {
  lastCheckAt?: string;
  lastAttempt?: { version: string; at: string };
}

/** Windows에서 npm은 npm.cmd라 shell 경유가 필요하다 (Node의 .cmd spawn 제한). */
function npmSpawnOptions() {
  return process.platform === "win32" ? { shell: true } : {};
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_LATEST_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/** 단순 semver(major.minor.patch) 비교. 형식이 어긋나면 업데이트하지 않는 쪽으로 판정한다. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.trim().split(".").map((n) => Number(n));
  const a = parse(latest);
  const b = parse(current);
  if (a.length !== 3 || b.length !== 3) return false;
  if ([...a, ...b].some((n) => !Number.isInteger(n) || n < 0)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** npm 전역 루트. npm이 없거나 실패하면 null — 자동 업데이트를 포기한다. */
function npmGlobalRoot(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "npm",
      ["root", "-g"],
      { timeout: 10_000, windowsHide: true, ...npmSpawnOptions() },
      (err, stdout) => resolve(err ? null : stdout.trim() || null),
    );
  });
}

/**
 * 새 버전이 있으면 백그라운드로 자기 자신을 업데이트한다.
 * - npm 전역 설치일 때만 실행한다 (cliPath가 `npm root -g` 아래인지 확인).
 *   pnpm/yarn/링크 설치에 npm을 덧씌우면 다른 복사본만 생기고 적용도 안 된다.
 * - statusline은 매 틱 새 프로세스로 뜨므로, 설치가 끝나면 다음 틱부터
 *   새 버전이 실행된다. 전역 경로는 버전과 무관해 설정 변경도 필요 없다.
 * - 실패해도 조용히 넘어간다 (렌더링·refresh에 영향 금지). 재시도는 주 1회.
 */
export async function maybeSelfUpdate(config: PingletConfig): Promise<void> {
  if (config.autoUpdate === false) return;

  const now = Date.now();
  const state = readJsonFile<UpdateState>(UPDATE_PATH) ?? {};
  const lastCheck = state.lastCheckAt ? Date.parse(state.lastCheckAt) : NaN;
  if (!Number.isNaN(lastCheck) && now - lastCheck < CHECK_INTERVAL_MS) return;

  // 확인 시각을 먼저 기록 — 레지스트리 장애 시에도 하루 1회 이상 두드리지 않는다.
  state.lastCheckAt = new Date(now).toISOString();
  writeJsonFile(UPDATE_PATH, state);

  const latest = await fetchLatestVersion();
  if (!latest || !isNewerVersion(latest, VERSION)) return;

  if (state.lastAttempt?.version === latest) {
    const at = Date.parse(state.lastAttempt.at);
    if (!Number.isNaN(at) && now - at < RETRY_INTERVAL_MS) return;
  }

  const root = await npmGlobalRoot();
  if (!root || !cliPath().startsWith(root + path.sep)) return;

  state.lastAttempt = { version: latest, at: new Date(now).toISOString() };
  writeJsonFile(UPDATE_PATH, state);

  try {
    const child = spawn(
      "npm",
      ["install", "-g", `pinglet-cli@${latest}`],
      { detached: true, stdio: "ignore", windowsHide: true, ...npmSpawnOptions() },
    );
    child.unref();
  } catch {
    // npm 실행 실패 — 다음 주기에 재시도된다.
  }
}
