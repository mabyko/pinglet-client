import { FeedMessage, RuntimeState } from "./types";

/**
 * 로컬 메시지 선택 (아키텍처 §12).
 * 서버가 이미 scoring해서 내려주므로 클라이언트는
 * seen penalty + 같은 메시지/작성자 연속 노출 억제만 담당한다.
 */
export function pickMessage(
  messages: FeedMessage[],
  state: RuntimeState,
): FeedMessage | null {
  if (messages.length === 0) return null;
  const current = state.current;

  let candidates = messages;
  if (messages.length > 1 && current) {
    const filtered = messages.filter((m) => m.id !== current.messageId);
    // 작성자 다양성: 직전과 같은 작성자를 피할 수 있으면 피한다.
    const diverse = filtered.filter((m) => m.author !== current.author);
    candidates = diverse.length > 0 ? diverse : filtered;
  }

  const weights = candidates.map((m) => 1 / (1 + (state.seen[m.id] ?? 0)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
