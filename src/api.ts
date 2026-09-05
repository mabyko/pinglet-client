import * as os from "os";
import { randomUUID } from "crypto";
import { PingletConfig, VERSION } from "./config";
import { AgentType, FeedMessage, InstallRecord, QueuedEvent } from "./types";

const TIMEOUT_MS = 5000;
/** 서버 EventBatchDto의 ArrayMaxSize(200)와 맞춘다. */
export const MAX_BATCH_SIZE = 200;

async function request<T>(
  config: Pick<PingletConfig, "apiBaseUrl">,
  method: string,
  apiPath: string,
  options: { token?: string; body?: unknown } = {},
): Promise<T | null> {
  try {
    const res = await fetch(config.apiBaseUrl + apiPath, {
      method,
      headers: {
        "content-type": "application/json",
        ...(options.token && { authorization: `Bearer ${options.token}` }),
      },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function checkHealth(config: PingletConfig): Promise<boolean> {
  const res = await request<{ status: string }>(config, "GET", "/health");
  return res?.status === "ok";
}

/** POST /installations — 익명 등록. 로그인 상태면 userToken으로 귀속된다. */
export async function registerInstallation(
  config: PingletConfig,
  agentType: AgentType,
): Promise<InstallRecord | null> {
  const res = await request<{ installationId: string; token: string }>(
    config,
    "POST",
    "/installations",
    {
      token: config.userToken,
      body: {
        agentType,
        os: `${process.platform}-${os.release()}`.slice(0, 50),
        clientVersion: VERSION,
      },
    },
  );
  if (!res?.installationId || !res.token) return null;
  return {
    installationId: res.installationId,
    token: res.token,
    registeredAt: new Date().toISOString(),
  };
}

interface FeedItem {
  messageId: string;
  text: string;
  authorNickname: string;
  contentType: string;
  category: string | null;
  expiresAt?: string | null;
}

/** GET /feed — 로컬 캐시용 메시지 30~50개를 미리 받는다. */
export async function fetchFeed(
  config: PingletConfig,
  record: InstallRecord,
  limit = 50,
): Promise<FeedMessage[] | null> {
  const res = await request<{ items: FeedItem[] }>(
    config,
    "GET",
    `/feed?limit=${limit}`,
    { token: record.token },
  );
  if (!res?.items) return null;
  return res.items
    .filter((item) => item.messageId && item.text)
    .map((item) => ({
      id: item.messageId,
      text: item.text,
      author: item.authorNickname || "익명의 개발자",
      category: item.category,
      expiresAt: item.expiresAt,
      contentType:
        item.contentType === "SYSTEM" || item.contentType === "SPONSORED"
          ? item.contentType
          : "USER",
    }));
}

/** POST /events/batch — eventId 기반으로 서버가 dedupe하므로 재전송에 안전하다. */
export async function uploadEventBatch(
  config: PingletConfig,
  record: InstallRecord,
  events: QueuedEvent[],
): Promise<boolean> {
  return (await uploadEventBatchResult(config, record, events)).ok;
}

export async function uploadEventBatchResult(
  config: PingletConfig, record: InstallRecord, events: QueuedEvent[],
): Promise<{ ok: boolean; permanent: boolean; status?: number }> {
  try {
    const res = await fetch(config.apiBaseUrl + "/events/batch", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        batchId: "batch_" + randomUUID(),
        events: events.map(({ eventId, type, messageId, visibleMs, occurredAt }) => ({
          eventId,
          type,
          messageId,
          ...(visibleMs !== undefined && { visibleMs }),
          occurredAt,
        })),
      }),
    });
    return { ok: res.ok, permanent: [400, 413, 422].includes(res.status), status: res.status };
  } catch { return { ok: false, permanent: false }; }
}

/** POST /installations/heartbeat — lastSeenAt 갱신. 응답의 온라인 설치 수를 돌려준다(구서버는 null). */
export async function sendHeartbeat(
  config: PingletConfig,
  record: InstallRecord,
): Promise<number | null> {
  const res = await request<{ ok: boolean; onlineInstallations?: number }>(
    config,
    "POST",
    "/installations/heartbeat",
    {
      token: record.token,
      body: { clientVersion: VERSION },
    },
  );
  return typeof res?.onlineInstallations === "number"
    ? res.onlineInstallations
    : null;
}

export interface CreateMessageResult {
  ok: boolean;
  id?: string;
  status?: "APPROVED" | "PENDING_REVIEW" | "REJECTED";
  moderationReason?: string;
  /** 실패 시 CLI에 보여줄 사유 구분 */
  error?: "LOGIN_REQUIRED" | "UNAUTHORIZED" | "RATE_LIMITED" | "NETWORK" | "SERVER";
}

/**
 * POST /messages — 메시지 작성 (분당 5개 제한).
 * 작성은 로그인(GitHub 또는 Google)이 필요하다 (읽기는 계속 익명).
 */
export async function createMessage(
  config: PingletConfig,
  text: string,
  category?: string,
  requestId: string = randomUUID(),
): Promise<CreateMessageResult> {
  const token = config.userToken;
  if (!token) return { ok: false, error: "LOGIN_REQUIRED" };
  try {
    const res = await fetch(config.apiBaseUrl + "/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, requestId, ...(category && { category }) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, error: "UNAUTHORIZED" };
    if (res.status === 429) return { ok: false, error: "RATE_LIMITED" };
    if (!res.ok) return { ok: false, error: "SERVER" };
    const body = (await res.json()) as {
      id: string;
      status: CreateMessageResult["status"];
      moderationReason?: string;
    };
    return {
      ok: true,
      id: body.id,
      status: body.status,
      moderationReason: body.moderationReason,
    };
  } catch {
    return { ok: false, error: "NETWORK" };
  }
}

export async function validateUserToken(config: Pick<PingletConfig, "apiBaseUrl">, token: string): Promise<boolean> {
  const user = await request<{ id: string }>(config, "GET", "/users/me", { token });
  return typeof user?.id === "string" && user.id.length > 0;
}

/** Revocation/unlink are idempotent. A 401 installation credential is already unusable.
 * Other failures (including an old server's 404) must not be reported as success.
 */
export async function releaseCredential(
  config: PingletConfig,
  kind: "user" | "unlink" | "installation",
  token: string,
): Promise<boolean> {
  try {
    const apiPath = kind === "user" ? "/auth/logout" : kind === "unlink" ? "/installations/unlink" : "/installations/current";
    const res = await fetch(config.apiBaseUrl + apiPath, {
      method: kind === "installation" ? "DELETE" : "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return true;
    if (!res.ok) return false;
    const body = await res.json() as { revoked?: boolean; unlinked?: boolean };
    return kind === "unlink" ? body.unlinked === true : body.revoked === true;
  } catch { return false; }
}

/**
 * POST /installations/link — 로그인 후 기존 익명 설치를 계정에 연결한다.
 * 소유 증명으로 installation "토큰"을 보낸다 (ID만으로는 연결 불가).
 */
export async function linkInstallation(
  config: PingletConfig,
  installationToken: string,
): Promise<boolean> {
  if (!config.userToken) return false;
  const res = await request<{ linked: boolean }>(
    config,
    "POST",
    "/installations/link",
    { token: config.userToken, body: { installationToken } },
  );
  return res?.linked === true;
}
