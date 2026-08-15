import { loadConfig } from "../config";
import { checkHealth } from "../api";
import { feedAgeMs, loadFeedMessages } from "../cache";
import { countEvents } from "../queue";
import {
  detectClaude,
  isClaudeIntegrationInstalled,
  spinnerVerbsStatus,
} from "../adapters/claude";
import { detectCodex, isCodexIntegrationInstalled } from "../adapters/codex";

const ok = (label: string) => console.log(`✓ ${label}`);
const warn = (label: string) => console.log(`○ ${label}`);
const bad = (label: string) => console.log(`✗ ${label}`);

export async function runDoctor(): Promise<void> {
  const config = loadConfig();
  console.log("");

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 18) ok(`Node.js ${process.versions.node}`);
  else bad(`Node.js ${process.versions.node} — 18 이상이 필요합니다`);

  // Claude
  if (detectClaude()) {
    ok("Claude Code detected");
    if (isClaudeIntegrationInstalled()) {
      ok("Claude integration installed");
      const spinner = spinnerVerbsStatus();
      if (spinner.count > 0) {
        ok(`Spinner 메시지: ${spinner.count}개 등록됨`);
      } else {
        warn("Spinner 메시지 미등록 — `pinglet refresh` 실행");
      }
    } else warn("Claude integration not installed — `pinglet install` 실행");
  } else {
    warn("Claude Code not found");
  }

  // Codex
  if (detectCodex()) {
    ok("Codex detected");
    if (isCodexIntegrationInstalled()) ok("Codex integration installed");
    else warn("Codex integration not installed — `pinglet install` 실행");
  } else {
    warn("Codex not found");
  }

  // 서버 등록 상태
  for (const agentType of ["CLAUDE", "CODEX"] as const) {
    const record = config.installations[agentType];
    if (record) ok(`${agentType} installation registered (${record.installationId})`);
  }
  if (Object.keys(config.installations).length === 0) {
    warn("서버에 등록된 installation이 없습니다 (오프라인 설치 상태)");
  }

  // 로컬 캐시 / 큐
  const messages = loadFeedMessages();
  const age = feedAgeMs();
  const seeded = messages.every((m) => m.id.startsWith("seed_"));
  if (seeded) {
    warn(`Feed cache: 시드 메시지 ${messages.length}개 (서버 feed 미수신)`);
  } else {
    const ageMin = age === null ? "?" : Math.round(age / 60_000);
    ok(`Feed cache: ${messages.length}개 (${ageMin}분 전 갱신)`);
  }
  const queued = countEvents();
  if (queued < 200) ok(`Event queue: ${queued}개 대기`);
  else warn(`Event queue: ${queued}개 대기 — 서버 전송이 밀려 있습니다`);

  // API
  const online = await checkHealth(config);
  if (online) ok(`API reachable (${config.apiBaseUrl})`);
  else warn(`API unreachable (${config.apiBaseUrl}) — 오프라인 모드로 동작 중`);

  if (config.userToken) ok("로그인됨");
  else warn("로그인 안 됨 — 익명 작성은 가능, 닉네임 표시/반응은 `pinglet login` 후");
  console.log("");
}
