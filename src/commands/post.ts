import { loadConfig } from "../config";
import { createMessage } from "../api";
import { saveMyPost } from "../cache";

const REASON_LABELS: Record<string, string> = {
  EMPTY: "빈 메시지는 등록할 수 없습니다",
  TOO_LONG: "메시지가 너무 깁니다 (기본 100자 제한)",
  URL_NOT_ALLOWED: "URL은 허용되지 않습니다",
  PII_DETECTED: "이메일/전화번호 등 개인정보가 포함되어 있습니다",
  BANNED_WORD: "정책상 검토가 필요한 표현이 포함되어 있습니다",
  CONTROL_CHARS: "제어 문자(escape sequence)는 허용되지 않습니다",
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
    console.log('사용법: pinglet post "메시지" [--category <카테고리>]');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const result = await createMessage(config, text, category);

  if (!result.ok) {
    switch (result.error) {
      case "LOGIN_REQUIRED":
        console.log(
          "✗ 메시지 작성에는 GitHub 로그인이 필요합니다. `pinglet login`을 실행하세요 (읽기는 로그인 없이 가능).",
        );
        break;
      case "UNAUTHORIZED":
        console.log(
          "✗ 로그인이 만료됐습니다. `pinglet login`으로 다시 로그인하세요.",
        );
        break;
      case "RATE_LIMITED":
        console.log("✗ 작성 제한(분당 5개)에 걸렸습니다. 잠시 후 다시 시도하세요.");
        break;
      case "NETWORK":
        console.log(`✗ 서버(${config.apiBaseUrl})에 연결할 수 없습니다.`);
        break;
      default:
        console.log("✗ 메시지 등록에 실패했습니다.");
    }
    process.exitCode = 1;
    return;
  }

  // statusline 도달 표시용으로 이 기기에서 쓴 메시지를 기록해 둔다.
  if (result.id && result.status !== "REJECTED") {
    saveMyPost({ id: result.id, text, postedAt: new Date().toISOString() });
  }

  const reason = result.moderationReason
    ? REASON_LABELS[result.moderationReason] ?? result.moderationReason
    : undefined;

  switch (result.status) {
    case "APPROVED":
      console.log("✓ 메시지가 등록됐습니다. 곧 다른 개발자들의 터미널에 표시됩니다.");
      if (!quiet) {
        console.log(`  id: ${result.id}`);
      }
      break;
    case "PENDING_REVIEW":
      console.log(`○ 메시지가 검토 대기 중입니다${reason ? ` — ${reason}` : ""}.`);
      if (!quiet) console.log("  승인되면 feed에 노출됩니다.");
      break;
    case "REJECTED":
      console.log(`✗ 메시지가 거절됐습니다${reason ? ` — ${reason}` : ""}.`);
      process.exitCode = 1;
      break;
  }
}
