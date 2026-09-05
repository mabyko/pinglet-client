import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { isMissing } from "./storage";

// Outside ~/.pinglet so purge cannot remove a lock held by another command.
const LOCK_PATH = path.join(os.homedir(), ".pinglet.lock");

function owner(lockPath: string): string | null {
  try { return fs.readFileSync(lockPath, "utf8"); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

function abandoned(value: string, lockPath: string): boolean {
  const pid = Number(value.split(/[:-]/)[0]);
  if (!Number.isInteger(pid) || pid <= 0) {
    // The creating process may not have written its PID yet.
    return Date.now() - fs.statSync(lockPath).mtimeMs > 30_000;
  }
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

function recover(lockPath: string): void {
  const recoveryPath = lockPath + ".recovery";
  const identity = `${process.pid}-${randomUUID()}`;
  // Serialize reapers and re-read ownership: a second reaper must never unlink
  // a fresh lock acquired after the first reaper removed the abandoned one.
  try { fs.mkdirSync(recoveryPath, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // A killed reaper must not block recovery forever. Unique owner filenames
      // ensure only the process that removed the old owner may remove its dir.
      try {
        const entries = fs.readdirSync(recoveryPath);
        if (entries.length === 1 && abandoned(entries[0], recoveryPath)) {
          fs.unlinkSync(path.join(recoveryPath, entries[0]));
          fs.rmdirSync(recoveryPath);
        } else if (entries.length === 0 && Date.now() - fs.statSync(recoveryPath).mtimeMs > 30_000) {
          // Legacy/partially-created recovery directory; allow initialization grace.
          fs.rmdirSync(recoveryPath);
        }
      } catch (cleanupError) {
        if (!isMissing(cleanupError) && !["ENOTEMPTY", "EEXIST"].includes((cleanupError as NodeJS.ErrnoException).code ?? "")) throw cleanupError;
      }
      return;
    }
    throw error;
  }
  const ownerPath = path.join(recoveryPath, identity);
  try {
    fs.writeFileSync(ownerPath, "", { flag: "wx", mode: 0o600 });
    const value = owner(lockPath);
    if (value !== null && abandoned(value, lockPath)) fs.unlinkSync(lockPath);
  } catch (error) { if (!isMissing(error)) throw error; }
  finally {
    try { fs.unlinkSync(ownerPath); fs.rmdirSync(recoveryPath); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
}

/** Short local read/modify/write transactions. Never hold this across network I/O. */
export async function withPingletLock<T>(
  action: () => T | Promise<T>,
  options: { skipIfBusy?: boolean; timeoutMs?: number; command?: boolean } = {},
): Promise<T | undefined> {
  const lockPath = options.command ? LOCK_PATH + ".command" : LOCK_PATH;
  const identity = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  for (;;) {
    let fd: number;
    try { fd = fs.openSync(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      recover(lockPath);
      if (owner(lockPath) === null) continue;
      if (options.skipIfBusy) return undefined;
      if (Date.now() >= deadline) throw new Error("Pinglet is busy. Retry after the other command finishes.");
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try { fs.writeFileSync(fd, identity); }
    catch (error) { fs.unlinkSync(lockPath); throw error; }
    finally { fs.closeSync(fd); }
    break;
  }
  try { return await action(); }
  finally { if (owner(lockPath) === identity) fs.unlinkSync(lockPath); }
}

/** Serializes administrative/network commands without excluding local hooks. */
export function withCommandLock<T>(action: () => T | Promise<T>) {
  return withPingletLock(action, { command: true });
}
