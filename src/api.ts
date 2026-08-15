import * as os from "os";
import { randomUUID } from "crypto";
import { PingletConfig, VERSION } from "./config";
import { AgentType, FeedMessage, InstallRecord, QueuedEvent } from "./types";

const TIMEOUT_MS = 5000;
/** 서버 EventBatchDto의 ArrayMaxSize(200)와 맞춘다. */
export const MAX_BATCH_SIZE = 200;

async function request<T>(
  config: PingletConfig,
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
  const res = await request<unknown>(config, "POST", "/events/batch", {
    token: record.token,
    body: {
      batchId: "batch_" + randomUUID(),
      events: events.map(({ eventId, type, messageId, visibleMs, occurredAt }) => ({
        eventId,
        type,
        messageId,
        ...(visibleMs !== undefined && { visibleMs }),
        occurredAt,
      })),
    },
  });
  return res !== null;
}

export async function sendHeartbeat(
  config: PingletConfig,
  record: InstallRecord,
): Promise<void> {
  await request(config, "POST", "/installations/heartbeat", {
    token: record.token,
    body: { clientVersion: VERSION },
  });
}

export interface CreateMessageResult {
  ok: boolean;
  id?: string;
  status?: "APPROVED" | "PENDING_REVIEW" | "REJECTED";
  moderationReason?: string;
  /** 실패 시 CLI에 보여줄 사유 구분 */
  error?: "UNAUTHORIZED" | "RATE_LIMITED" | "NETWORK" | "SERVER";
}

/**
 * POST /messages — 메시지 작성 (분당 5개 제한).
 * 로그인했으면 유저 토큰으로(닉네임 표시), 아니면 설치 토큰으로 익명 작성한다.
 */
export async function createMessage(
  config: PingletConfig,
  text: string,
  category?: string,
): Promise<CreateMessageResult> {
  const token =
    config.userToken ?? Object.values(config.installations)[0]?.token;
  if (!token) return { ok: false, error: "UNAUTHORIZED" };
  try {
    const res = await fetch(config.apiBaseUrl + "/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, ...(category && { category }) }),
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

/** POST /installations/link — 로그인 후 기존 익명 설치를 계정에 연결한다. */
export async function linkInstallation(
  config: PingletConfig,
  installationId: string,
): Promise<boolean> {
  if (!config.userToken) return false;
  const res = await request<{ linked: boolean }>(
    config,
    "POST",
    "/installations/link",
    { token: config.userToken, body: { installationId } },
  );
  return res?.linked === true;
}
