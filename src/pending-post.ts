import { createHash, randomUUID } from "crypto";
import * as path from "path";
import { PINGLET_DIR, PingletConfig, readJsonFile, writeJsonFile } from "./config";

const PENDING_PATH = path.join(PINGLET_DIR, "pending-posts.json");
interface PendingPost { key: string; requestId: string }

/** Persist before sending so retrying an ambiguous network failure uses the same ID.
 * Only hashes are stored: no message text or bearer token in the retry journal.
 */
export function pendingPostId(config: PingletConfig, text: string, category?: string): string {
  const key = createHash("sha256").update(JSON.stringify([config.apiBaseUrl, config.userToken, text, category ?? null])).digest("hex");
  const pending = readJsonFile<PendingPost[]>(PENDING_PATH) ?? [];
  const existing = pending.find((p) => p.key === key);
  if (existing) return existing.requestId;
  const requestId = randomUUID();
  writeJsonFile(PENDING_PATH, [...pending, { key, requestId }]);
  return requestId;
}

export function completePost(requestId: string): void {
  const pending = readJsonFile<PendingPost[]>(PENDING_PATH) ?? [];
  writeJsonFile(PENDING_PATH, pending.filter((p) => p.requestId !== requestId));
}
