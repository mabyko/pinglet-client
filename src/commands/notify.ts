import { execFile } from "child_process";
import { loadState, saveState, loadFeedMessages } from "../cache";
import { pickMessage } from "../picker";
import { appendEvent } from "../queue";
import { runMaintenance } from "../runtime";
import * as fs from "fs";
import { CONFIG_PATH, loadConfig } from "../config";

/**
 * Codex CLI notify hook 진입점 (experimental).
 * Codex는 turn 완료 시 마지막 인자로 notification JSON을 넘긴다.
 * notify 프로세스는 TUI 밖에서 돌기 때문에 MVP에서는 macOS 알림으로 Ping을 전달한다.
 */
export function runNotify(args: string[]): void {
  if (!fs.existsSync(CONFIG_PATH) || !loadConfig().adapters.codex) return;
  let notificationType: string | undefined;
  try {
    const payload = JSON.parse(args[args.length - 1] ?? "");
    notificationType = payload?.type;
  } catch {
    // payload가 없으면 그냥 진행 (수동 테스트 허용)
  }
  if (notificationType && notificationType !== "agent-turn-complete") {
    return;
  }

  const state = loadState();
  const now = Date.now();
  const message = pickMessage(loadFeedMessages(), state);
  if (!message) {
    runMaintenance(state, now);
    saveState(state);
    return;
  }
  appendEvent({ agentType: "CODEX", type: "DELIVERED", messageId: message.id });
  state.seen[message.id] = (state.seen[message.id] ?? 0) + 1;
  runMaintenance(state, now);
  saveState(state);

  if (process.platform === "darwin") {
    const body = message.text.replace(/["\\]/g, "");
    const title = `Pinglet — ${message.author.replace(/["\\]/g, "")}`;
    execFile(
      "osascript",
      ["-e", `display notification "${body}" with title "${title}"`],
      () => {},
    );
  }
}
