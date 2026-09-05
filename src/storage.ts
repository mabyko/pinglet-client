import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** A unique, private temporary file prevents partial reads and writer collisions. */
export function atomicWrite(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, body, { flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) { if (!isMissing(error)) throw error; }
  }
}
