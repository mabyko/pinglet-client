import { spawn } from "child_process";
import * as readline from "readline";
import { loadConfig, saveConfig } from "../config";
import { linkInstallation } from "../api";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/**
 * GitHub OAuth 로그인.
 * 브라우저에서 /auth/github → callback JSON의 token을 CLI에 붙여넣는 방식 (MVP).
 */
export async function runLogin(args: string[]): Promise<void> {
  const config = loadConfig();

  let token: string | undefined;
  const tokenIndex = args.indexOf("--token");
  if (tokenIndex !== -1 && args[tokenIndex + 1]) {
    token = args[tokenIndex + 1];
  }

  if (!token) {
    const url = `${config.apiBaseUrl}/auth/github`;
    console.log("\n브라우저에서 GitHub 로그인 후, 응답 JSON의 token 값을 붙여넣어 주세요.");
    console.log(`  ${url}\n`);
    if (process.platform === "darwin") {
      try {
        spawn("open", [url], { stdio: "ignore" }).unref();
      } catch {
        // 브라우저를 못 열어도 URL은 출력했으므로 진행
      }
    }
    token = (await prompt("token: ")).trim();
  }

  if (!token) {
    console.log("✗ token이 비어 있습니다.");
    process.exitCode = 1;
    return;
  }

  config.userToken = token;
  saveConfig(config);
  console.log("✓ 로그인 정보 저장 완료");

  for (const [agentType, record] of Object.entries(config.installations)) {
    const linked = await linkInstallation(config, record.token);
    console.log(
      linked
        ? `✓ ${agentType} installation을 계정에 연결했습니다`
        : `○ ${agentType} installation 연결 실패 — 서버 연결 후 다시 시도하세요`,
    );
  }
}
