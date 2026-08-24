#!/usr/bin/env node
import { VERSION, loadConfig } from "./config";
import { runInstall } from "./commands/install";
import { runUninstall } from "./commands/uninstall";
import { runDoctor } from "./commands/doctor";
import { runLogin } from "./commands/login";
import { runStatusline } from "./commands/statusline";
import { runNotify } from "./commands/notify";
import { runFlush } from "./commands/flush";
import { runRefresh } from "./commands/refresh";
import { runPing } from "./commands/ping";
import { runPost } from "./commands/post";

const HELP = `pinglet v${VERSION} — AI가 생각하는 동안 만나는 개발자 메시지 네트워크

사용법: pinglet <command>

  install [--api <url>] [--force]   Claude Code integration 설치
          [--claude | --codex]      Codex는 OS 알림 방식이라 --codex로 opt-in (experimental)
  uninstall [--purge]               integration 제거 (--purge: ~/.pinglet까지 삭제)
  login [--token <jwt>]             GitHub 계정 연결
  post "메시지" [--category <c>]     메시지 작성 (GitHub 로그인 필요, 읽기는 익명 가능)
  doctor                            설치/캐시/서버 상태 진단
  ping                              메시지 미리보기

내부 명령 (integration이 호출):
  statusline                        Claude Code statusLine hook
  notify                            Codex notify hook
  flush                             이벤트 큐 batch 전송
  refresh                           feed 캐시 갱신 + heartbeat
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "install":
      await runInstall(rest);
      break;
    case "uninstall":
      runUninstall(rest);
      break;
    case "login":
      await runLogin(rest);
      break;
    case "doctor":
      await runDoctor();
      break;
    case "post":
      await runPost(rest);
      break;
    case "ping":
      runPing();
      break;
    case "statusline":
      runStatusline();
      break;
    case "notify":
      runNotify(rest);
      break;
    case "flush":
      await runFlush();
      break;
    case "refresh":
      await runRefresh();
      break;
    case "--version":
    case "-v":
      console.log(VERSION);
      break;
    default:
      // 최신 npm은 postinstall을 차단하므로, 설정 전 상태에서 bare `pinglet`을
      // 치면 help 대신 바로 첫 설정을 시작한다 (막다른 길 제거).
      if (!command) {
        const config = loadConfig();
        if (!config.adapters.claude && !config.adapters.codex) {
          console.log("pinglet: 아직 설정 전입니다 — 첫 설정을 시작합니다.");
          await runInstall([]);
          break;
        }
      }
      console.log(HELP);
      if (command && command !== "help" && command !== "--help") {
        process.exitCode = 1;
      }
  }
}

main().catch((error) => {
  // statusline/notify는 조용히 실패해야 Claude/Codex 경험을 해치지 않는다.
  const command = process.argv[2];
  if (command === "statusline" || command === "notify") {
    process.exit(0);
  }
  console.error("pinglet:", error instanceof Error ? error.message : error);
  process.exit(1);
});
