import { loadFeedMessages, loadState } from "../cache";
import { pickMessage } from "../picker";
import { formatPing } from "../render";
import { t } from "../i18n";

/** 미리보기: 이벤트 기록 없이 메시지 하나를 골라 출력한다. */
export function runPing(): void {
  const message = pickMessage(loadFeedMessages(), loadState());
  if (!message) {
    console.log(t("ping.none"));
    return;
  }
  console.log(formatPing(message));
}
