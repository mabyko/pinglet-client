import { spawn } from "child_process";
import * as http from "http";
import { AddressInfo } from "net";
import * as readline from "readline";
import { loadConfig, saveConfig } from "../config";
import { linkInstallation } from "../api";

const LOGIN_TIMEOUT_MS = 180_000;

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

function openBrowser(url: string): boolean {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    spawn(cmd[0], cmd.slice(1), { stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

const RESULT_HTML = (ok: boolean) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Pinglet</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#0f1115;color:#e6e9ef}
div{text-align:center}p{color:#8b93a3}</style></head><body><div>
<h1>${ok ? "💌 로그인 완료" : "✗ 로그인 실패"}</h1>
<p>${ok ? "이 창을 닫고 터미널로 돌아가세요." : "터미널에서 다시 시도해 주세요."}</p>
</div></body></html>`;

/**
 * 루프백 로그인: 일회용 로컬 서버를 띄우고 브라우저에서 OAuth를 마치면
 * 서버가 http://127.0.0.1:{port}/callback?token=... 으로 토큰을 넘겨준다.
 * 타임아웃/실패 시 null — 호출부가 수동 붙여넣기로 폴백한다.
 */
function loginViaLoopback(apiBaseUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    let finished = false;
    const done = (token: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      // 마지막 응답이 flush될 시간을 주고 닫는다.
      setTimeout(() => {
        server.closeAllConnections?.();
        server.close();
      }, 200).unref();
      resolve(token);
    };
    const timer = setTimeout(() => done(null), LOGIN_TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const token = url.searchParams.get("token");
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(RESULT_HTML(Boolean(token)));
      done(token);
    });
    server.on("error", () => done(null));

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const url = `${apiBaseUrl}/auth/github?cli_port=${port}`;
      console.log("브라우저에서 GitHub 로그인을 완료해 주세요…");
      console.log(`  ${url}\n`);
      openBrowser(url);
    });
  });
}

/** GitHub OAuth 로그인 — 루프백 자동 수신, 실패 시 수동 붙여넣기 폴백. */
export async function runLogin(args: string[]): Promise<void> {
  const config = loadConfig();

  let token: string | undefined;
  const tokenIndex = args.indexOf("--token");
  if (tokenIndex !== -1 && args[tokenIndex + 1]) {
    token = args[tokenIndex + 1];
  }

  if (!token) {
    console.log(
      `\n로그인하면 이용약관(${config.apiBaseUrl}/terms)과 개인정보처리방침(${config.apiBaseUrl}/privacy)에 동의하는 것으로 간주됩니다.`,
    );
    token = (await loginViaLoopback(config.apiBaseUrl)) ?? undefined;
    if (!token) {
      // SSH 등 브라우저와 터미널이 다른 기계인 경우를 위한 폴백.
      console.log(
        "자동 로그인에 실패했습니다. 아래 URL에서 로그인 후 응답 JSON의 token 값을 붙여넣어 주세요.",
      );
      console.log(`  ${config.apiBaseUrl}/auth/github\n`);
      token = (await prompt("token: ")).trim();
    }
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
