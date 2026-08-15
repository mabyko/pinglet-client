import { loadFeedMessages, loadState } from "../cache";
import { pickMessage } from "../picker";
import { formatPing } from "../render";

/** 미리보기: 이벤트 기록 없이 메시지 하나를 골라 출력한다. */
export function runPing(): void {
  const message = pickMessage(loadFeedMessages(), loadState());
  console.log(formatPing(message));
}
