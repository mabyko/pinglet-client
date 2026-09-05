import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { CONFIG_PATH, PINGLET_DIR, loadConfig } from "./config";
import { runNotify } from "./commands/notify";
import { isMissing } from "./storage";

const PREFIX = "notify-";

/** Unique files allow enqueueing without waiting for the state lock. Store only
 * the event type, never the Codex payload (which can contain user/code content).
 * Do not mkdir: a concurrent purge must not be undone by a stale hook.
 */
export function enqueueNotification(args: string[]): boolean {
  if (!fs.existsSync(CONFIG_PATH)) return false;
  const config = loadConfig();
  const adapter = config.adapters.codex;
  if (!adapter) return false;
  let type = "agent-turn-complete";
  try { type = JSON.parse(args[args.length - 1] ?? "")?.type ?? type; } catch { /* manual invocation */ }
  if (type !== "agent-turn-complete") return false;
  const file = path.join(PINGLET_DIR, `${PREFIX}${randomUUID()}.json`);
  const temp = file + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify({ type, installedAt: adapter.installedAt, apiBaseUrl: config.apiBaseUrl }), { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch (error) {
    if (!isMissing(error)) throw error;
    return false;
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (!isMissing(error)) throw error; }
  }
}

/** Caller holds the short state lock. Failed work stays on disk for retry. */
export function drainNotifications(): void {
  if (!fs.existsSync(CONFIG_PATH)) return;
  const config = loadConfig();
  for (const name of fs.readdirSync(PINGLET_DIR).filter(name => name.startsWith(PREFIX) && name.endsWith(".json"))) {
    const file = path.join(PINGLET_DIR, name);
    const event = JSON.parse(fs.readFileSync(file, "utf8"));
    if (config.adapters.codex?.installedAt === event.installedAt && config.apiBaseUrl === event.apiBaseUrl) {
      runNotify([JSON.stringify({ type: event.type })], "evt_" + name.slice(PREFIX.length, -5));
    }
    fs.unlinkSync(file); // Stale installation notifications must not survive reinstall.
  }
}
