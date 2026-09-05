import {
  FEED_PATH,
  ONLINE_PATH,
  POSTS_PATH,
  STATE_PATH,
  readJsonFile,
  writeJsonFile,
} from "./config";
import {
  FeedCacheFile,
  FeedMessage,
  MyPostRecord,
  OnlineCache,
  RuntimeState,
} from "./types";

/**
 * 렌더링 path에서 호출되므로 전부 동기 I/O — 네트워크는 절대 타지 않는다.
 * 서버 feed를 아직 못 받았으면 빈 배열 — Pinglet은 아무것도 표시하지 않고
 * Claude Code 기본 spinner가 그대로 유지된다.
 */
export const MAX_FEED_AGE_MS = 10 * 60_000;

export function loadFeedMessages(): FeedMessage[] {
  const cache = readJsonFile<FeedCacheFile>(FEED_PATH);
  if (!cache || !Array.isArray(cache.messages)) return [];
  const fetchedAt = Date.parse(cache.fetchedAt);
  const now = Date.now();
  if (!Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt >= MAX_FEED_AGE_MS) return [];
  return cache.messages.filter((m) => m.expiresAt == null || Date.parse(m.expiresAt) > now);
}

export function saveFeedMessages(messages: FeedMessage[]): void {
  const file: FeedCacheFile = {
    fetchedAt: new Date().toISOString(),
    messages,
  };
  writeJsonFile(FEED_PATH, file);
}

/** 서버 feed를 마지막으로 받은 시점부터의 경과(ms). 캐시가 없으면 null. */
export function feedAgeMs(): number | null {
  const cache = readJsonFile<FeedCacheFile>(FEED_PATH);
  if (!cache?.fetchedAt) return null;
  const t = Date.parse(cache.fetchedAt);
  return Number.isNaN(t) ? null : Date.now() - t;
}

export function loadState(): RuntimeState {
  const state = readJsonFile<RuntimeState>(STATE_PATH);
  if (state) {
    state.seen ??= {};
    return state;
  }
  return { seen: {} };
}

export function loadMyPosts(): MyPostRecord[] {
  return readJsonFile<MyPostRecord[]>(POSTS_PATH) ?? [];
}

export function saveMyPost(post: MyPostRecord): void {
  const posts = [post, ...loadMyPosts()].slice(0, 20);
  writeJsonFile(POSTS_PATH, posts);
}


export function loadOnline(): OnlineCache | null {
  return readJsonFile<OnlineCache>(ONLINE_PATH);
}

export function saveOnline(count: number): void {
  const cache: OnlineCache = {
    onlineInstallations: count,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(ONLINE_PATH, cache);
}

export function saveState(state: RuntimeState): void {
  // seen/delivered map이 무한히 자라지 않게 상한을 둔다.
  const keys = Object.keys(state.seen);
  if (keys.length > 500) {
    for (const key of keys.slice(0, keys.length - 500)) {
      delete state.seen[key];
    }
  }
  const delivered = state.delivered ?? {};
  const deliveredKeys = Object.keys(delivered);
  if (deliveredKeys.length > 2000) {
    for (const key of deliveredKeys.slice(0, deliveredKeys.length - 2000)) {
      delete delivered[key];
    }
  }
  writeJsonFile(STATE_PATH, state);
}
