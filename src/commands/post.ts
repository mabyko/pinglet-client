import { loadConfig } from "../config";
import { createMessage } from "../api";

const REASON_LABELS: Record<string, string> = {
  EMPTY: "빈 메시지는 등록할 수 없습니다",
  TOO_LONG: "메시지가 너무 깁니다 (기본 100자 제한)",
  URL_NOT_ALLOWED: "URL은 허용되지 않습니다",
  PII_DETECTED: "이메일/전화번호 등 개인정보가 포함되어 있습니다",
  BANNED_WORD: "정책상 검토가 필요한 표현이 포함되어 있습니다",
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
      case "UNAUTHORIZED":
        console.log(
          "✗ 인증 정보가 없습니다. 먼저 `pinglet install`을 실행하세요 (로그인 없이도 익명 작성 가능).",
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

  const reason = result.moderationReason
    ? REASON_LABELS[result.moderationReason] ?? result.moderationReason
    : undefined;

  switch (result.status) {
    case "APPROVED":
      console.log("✓ 메시지가 등록됐습니다. 곧 다른 개발자들의 터미널에 표시됩니다.");
      if (!quiet) {
        console.log(`  id: ${result.id}`);
        if (!config.userToken) {
          console.log(
            "  '익명의 개발자'로 표시됩니다 — 닉네임을 달려면 `pinglet login`",
          );
        }
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
