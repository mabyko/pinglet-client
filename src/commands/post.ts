import { loadConfig } from "../config";
import { createMessage } from "../api";
import { saveMyPost } from "../cache";
import { MessageKey, t } from "../i18n";
import { pendingPostId, completePost } from "../pending-post";

const REASON_KEYS: Record<string, MessageKey> = {
  EMPTY: "reason.EMPTY",
  TOO_LONG: "reason.TOO_LONG",
  URL_NOT_ALLOWED: "reason.URL_NOT_ALLOWED",
  PII_DETECTED: "reason.PII_DETECTED",
  BANNED_WORD: "reason.BANNED_WORD",
  CONTROL_CHARS: "reason.CONTROL_CHARS",
};

/**
 * `pinglet post "메시지" [--category <카테고리>] [--quiet]`
 * --quiet: /pinglet slash command용 — id/로그인 안내 없이 결과 한 줄만 출력.
 */
export async function runPost(args: string[]): Promise<void> {
  let category: string | undefined;
  let quiet = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && args[i + 1]) {
      category = args[++i];
    } else if (args[i] === "--quiet") {
      quiet = true;
    } else {
      rest.push(args[i]);
    }
  }
  const text = rest.join(" ").trim();

  if (!text) {
    console.log(quiet ? t("post.emptyQuiet") : t("post.usage"));
    if (!quiet) process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const requestId = pendingPostId(config, text, category);
  const result = await createMessage(config, text, category, requestId);
  // Only a definitive response resolves an earlier ambiguous commit. In
  // particular 401/429 say nothing about whether the previous request committed.
  if (result.ok) completePost(requestId);
  // 슬래시 명령 안에서는 같은 방식의 슬래시 명령을 안내한다.
  const loginCmd = quiet ? "/pinglet-login" : "pinglet login";

  if (!result.ok) {
    switch (result.error) {
      case "LOGIN_REQUIRED":
        console.log(t("post.loginRequired", { cmd: loginCmd }));
        break;
      case "UNAUTHORIZED":
        console.log(t("post.expired", { cmd: loginCmd }));
        break;
      case "RATE_LIMITED":
        console.log(t("post.rateLimited"));
        break;
      case "NETWORK":
        console.log(t("post.network", { api: config.apiBaseUrl }));
        break;
      default:
        console.log(t("post.failed"));
    }
    // --quiet(/pinglet slash command)에서는 exit 0 유지 — exit 1이면 Claude Code가
    // 안내 문구 대신 "Shell command failed" 에러 덤프를 보여준다.
    if (!quiet) process.exitCode = 1;
    return;
  }

  // 이 기기에서 쓴 메시지를 기록해 둔다.
  if (result.id && result.status !== "REJECTED") {
    saveMyPost({ id: result.id, text, postedAt: new Date().toISOString() });
  }

  const reasonKey = result.moderationReason
    ? REASON_KEYS[result.moderationReason]
    : undefined;
  const reason = result.moderationReason
    ? reasonKey
      ? t(reasonKey)
      : result.moderationReason
    : "";

  switch (result.status) {
    case "APPROVED":
      console.log(t("post.approved"));
      if (!quiet) {
        console.log(`  id: ${result.id}`);
      }
      break;
    case "PENDING_REVIEW":
      console.log(t("post.pending", { reason }));
      if (!quiet) console.log(t("post.pendingNote"));
      break;
    case "REJECTED":
      console.log(t("post.rejected", { reason }));
      if (!quiet) process.exitCode = 1;
      break;
  }
}
