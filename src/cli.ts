#!/usr/bin/env node
import { VERSION, loadConfig } from "./config";
import { runInstall } from "./commands/install";
import { runUninstall } from "./commands/uninstall";
import { runDoctor } from "./commands/doctor";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { runStatusline } from "./commands/statusline";
import { runNotify } from "./commands/notify";
import { runFlush } from "./commands/flush";
import { runRefresh } from "./commands/refresh";
import { runPing } from "./commands/ping";
import { runPost } from "./commands/post";
import { t } from "./i18n";

const HELP = t("cli.help", { version: VERSION });

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
    case "logout":
      runLogout();
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
          console.log(t("cli.firstSetup"));
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
