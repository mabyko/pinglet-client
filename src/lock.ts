import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { isMissing } from "./storage";

// Outside ~/.pinglet so purge cannot remove a lock held by another command.
const LOCK_PATH = path.join(os.homedir(), ".pinglet.lock");
const RECOVERY_PATH = LOCK_PATH + ".recovery";

function owner(): string | null {
  try { return fs.readFileSync(LOCK_PATH, "utf8"); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

function abandoned(value: string): boolean {
  const pid = Number(value.split(":")[0]);
  if (!Number.isInteger(pid) || pid <= 0) {
    // The creating process may not have written its PID yet.
    return Date.now() - fs.statSync(LOCK_PATH).mtimeMs > 30_000;
  }
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

function recover(): void {
  // Serialize reapers and re-read ownership: a second reaper must never unlink
  // a fresh lock acquired after the first reaper removed the abandoned one.
  try { fs.mkdirSync(RECOVERY_PATH, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
  try {
    const value = owner();
    if (value !== null && abandoned(value)) fs.unlinkSync(LOCK_PATH);
  } catch (error) { if (!isMissing(error)) throw error; }
  finally { fs.rmdirSync(RECOVERY_PATH); }
}

/** Serialize the entire read/modify/write command, including asynchronous work.
 * Hooks skip a busy tick instead of blocking Claude/Codex rendering.
 */
export async function withPingletLock<T>(
  action: () => T | Promise<T>,
  options: { skipIfBusy?: boolean; timeoutMs?: number } = {},
): Promise<T | undefined> {
  const identity = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  for (;;) {
    let fd: number;
    try { fd = fs.openSync(LOCK_PATH, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      recover();
      if (owner() === null) continue;
      if (options.skipIfBusy) return undefined;
      if (Date.now() >= deadline) throw new Error("Pinglet is busy. Retry after the other command finishes.");
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try { fs.writeFileSync(fd, identity); }
    catch (error) { fs.unlinkSync(LOCK_PATH); throw error; }
    finally { fs.closeSync(fd); }
    break;
  }
  try { return await action(); }
  finally { if (owner() === identity) fs.unlinkSync(LOCK_PATH); }
}
