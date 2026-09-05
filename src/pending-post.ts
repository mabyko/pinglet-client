import { createHash, randomUUID } from "crypto";
import * as path from "path";
import { PINGLET_DIR, PingletConfig, readJsonFile, writeJsonFile } from "./config";

const PENDING_PATH = path.join(PINGLET_DIR, "pending-posts.json");
interface PendingPost { key: string; requestId: string }

/** Persist before sending so retrying an ambiguous network failure uses the same ID.
 * Only hashes are stored: no message text or bearer token in the retry journal.
 */
export function pendingPostId(config: PingletConfig, text: string, category?: string): string {
  // The JWT subject is used only as a local journal namespace, never for auth.
  // Refreshing/replacing a token for the same user must retain pending requests.
  let account = config.userToken;
  try {
    const payload = JSON.parse(Buffer.from(config.userToken?.split(".")[1] ?? "", "base64url").toString());
    if (payload.kind === "user" && typeof payload.sub === "string") account = payload.sub;
  } catch { /* Legacy/non-JWT fixture tokens retain their previous namespace. */ }
  const digest = (identity: string | undefined) => createHash("sha256").update(JSON.stringify([config.apiBaseUrl, identity, text, category || null])).digest("hex");
  const key = digest(account);
  const pending = readJsonFile<PendingPost[]>(PENDING_PATH) ?? [];
  const existing = pending.find((p) => p.key === key || p.key === digest(config.userToken));
  if (existing) {
    if (existing.key !== key) { existing.key = key; writeJsonFile(PENDING_PATH, pending); }
    return existing.requestId;
  }
  const requestId = randomUUID();
  writeJsonFile(PENDING_PATH, [...pending, { key, requestId }]);
  return requestId;
}

export function completePost(requestId: string): void {
  const pending = readJsonFile<PendingPost[]>(PENDING_PATH) ?? [];
  writeJsonFile(PENDING_PATH, pending.filter((p) => p.requestId !== requestId));
}
