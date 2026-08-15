import { loadFeedMessages, loadState } from "../cache";
import { pickMessage } from "../picker";
import { formatPing } from "../render";

/** 미리보기: 이벤트 기록 없이 메시지 하나를 골라 출력한다. */
export function runPing(): void {
  const message = pickMessage(loadFeedMessages(), loadState());
  if (!message) {
    console.log("표시할 Ping이 없습니다 — 서버 feed를 받으면 표시됩니다.");
    return;
  }
  console.log(formatPing(message));
}
