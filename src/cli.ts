#!/usr/bin/env node
import { VERSION, loadConfig } from "./config";
import { runInstall } from "./commands/install";
import { runUninstall } from "./commands/uninstall";
import { runDoctor } from "./commands/doctor";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { runStatusline, writeStatusline } from "./commands/statusline";
import { runFlush } from "./commands/flush";
import { runRefresh } from "./commands/refresh";
import { runPing } from "./commands/ping";
import { runPost } from "./commands/post";
import { runHud } from "./commands/hud";
import { t } from "./i18n";
import { withPingletLock, withCommandLock } from "./lock";
import { enqueueNotification, drainNotifications } from "./notifications";
import { spawnDetachedCommand } from "./runtime";

const HELP = t("cli.help", { version: VERSION });

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "install":
      await runInstall(rest);
      break;
    case "uninstall":
      await runUninstall(rest);
      break;
    case "login":
      await runLogin(rest);
      break;
    case "logout":
      await runLogout();
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
    case "hud": {
      const quiet = rest.includes("--quiet");
      await runHud(rest.filter((arg) => arg !== "--quiet"), { quiet });
      break;
    }
    case "statusline": {
      const tick = runStatusline();
      if (tick) await writeStatusline(tick);
      break;
    }
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

async function dispatch(): Promise<void> {
  const command = process.argv[2];
  if (command === "notify") {
    if (enqueueNotification(process.argv.slice(3))) spawnDetachedCommand(["notify-drain"]);
    return;
  }
  if (command === "notify-drain" || command === "statusline") {
    // 잠금은 상태 파일 읽기/쓰기 구간만 보호한다. transcript·git을 읽는 HUD 렌더는 잠금 밖에서.
    const tick = await withPingletLock(() => {
      drainNotifications();
      return command === "statusline" ? runStatusline() : undefined;
    }, { skipIfBusy: command === "statusline" });
    if (tick) await writeStatusline(tick);
    return;
  }
  if (["--version", "-v", "help", "--help"].includes(command)) { await main(); return; }
  await withCommandLock(main);
  await withPingletLock(drainNotifications);
}

dispatch().catch((error) => {
  // statusline/notify는 조용히 실패해야 Claude/Codex 경험을 해치지 않는다.
  const command = process.argv[2];
  if (command === "statusline" || command === "notify" || command === "notify-drain") {
    process.exit(0);
  }
  console.error("pinglet:", error instanceof Error ? error.message : error);
  process.exit(1);
});
