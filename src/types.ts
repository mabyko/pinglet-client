export type AgentType = "CLAUDE" | "CODEX";

export type EventType = "DELIVERED" | "QUALIFIED_IMPRESSION";

/** 로컬 캐시에 저장되는 정규화된 메시지. 서버 feed item 또는 시드에서 생성된다. */
export interface FeedMessage {
  id: string;
  text: string;
  author: string;
  category?: string | null;
  contentType: "USER" | "SYSTEM" | "SPONSORED";
}

export interface FeedCacheFile {
  fetchedAt: string;
  messages: FeedMessage[];
}

/** events.jsonl 한 줄. agentType은 전송 시 installation 라우팅에만 쓰고 서버에는 보내지 않는다. */
export interface QueuedEvent {
  eventId: string;
  agentType: AgentType;
  type: EventType;
  messageId: string;
  visibleMs?: number;
  occurredAt: string;
}

export interface RuntimeState {
  current?: {
    messageId: string;
    text: string;
    author: string;
    shownAt: number; // epoch ms
  };
  /** messageId -> 노출 횟수 (seen penalty) */
  seen: Record<string, number>;
  /** spinner에 실려 DELIVERED 이벤트를 이미 보낸 messageId 집합 */
  delivered?: Record<string, number>;
  lastTickAt?: number;
  lastFlushAt?: number;
  lastRefreshAt?: number;
}

/** posts.json 항목 — 이 기기에서 작성한 메시지. */
export interface MyPostRecord {
  id: string;
  text: string;
  postedAt: string;
}

/** mystats.json — 최근 작성 메시지의 도달 통계 캐시. */
export interface MyStatsCache {
  messageId: string;
  text: string;
  reachedInstallations: number;
  delivered: number;
  qualifiedImpressions: number;
  reactions: number;
  updatedAt: string;
}

export interface InstallRecord {
  installationId: string;
  token: string;
  registeredAt: string;
}
