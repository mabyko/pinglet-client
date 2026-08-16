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
  /** 현재 spinner에 armed된 메시지 (pool=1 회전) */
  current?: {
    messageId: string;
    text: string;
    author: string;
    shownAt: number; // epoch ms
    /** 이 메시지가 armed된 동안 spinner가 실제로 돈 시간(ms) — cost 델타로 측정 */
    visibleMs?: number;
  };
  /** messageId -> 노출 횟수 (seen penalty) */
  seen: Record<string, number>;
  /** DELIVERED 이벤트를 이미 보낸 messageId 집합 */
  delivered?: Record<string, number>;
  /** session_id -> 마지막으로 본 cost.total_api_duration_ms (spinner 활동 감지용) */
  sessions?: Record<string, number>;
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
  /** 최근 7일 활성 설치 수 (커버리지 분모) */
  activeInstallations?: number;
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
