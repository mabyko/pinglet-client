import { spawn } from "child_process";
import * as http from "http";
import { AddressInfo } from "net";
import * as readline from "readline";
import { loadConfig, saveConfig } from "../config";
import { linkInstallation, validateUserToken, releaseCredential } from "../api";
import { currentLocale, t } from "../i18n";

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
    const child = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const RESULT_HTML = (ok: boolean) => `<!doctype html>
<html lang="${currentLocale()}"><head><meta charset="utf-8"><title>Pinglet</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#0f1115;color:#e6e9ef}
div{text-align:center}p{color:#8b93a3}</style></head><body><div>
<h1>${ok ? t("login.html.ok") : t("login.html.fail")}</h1>
<p>${ok ? t("login.html.okSub") : t("login.html.failSub")}</p>
</div></body></html>`;

type Provider = "github" | "google";

/** provider가 없으면 백엔드의 로그인 방식 선택 페이지(/auth/login)를 연다. */
function loginPath(provider?: Provider): string {
  return provider ? `/auth/${provider}` : "/auth/login";
}

function providerLabel(provider?: Provider): string {
  if (provider === "google") return "Google";
  if (provider === "github") return "GitHub";
  return t("login.anyProvider");
}

/**
 * 루프백 로그인: 일회용 로컬 서버를 띄우고 브라우저에서 OAuth를 마치면
 * 서버가 http://127.0.0.1:{port}/callback?token=... 으로 토큰을 넘겨준다.
 * 타임아웃/실패 시 null — 호출부가 수동 붙여넣기로 폴백한다.
 * quiet(슬래시 명령)에서는 출력이 완료 후에야 한꺼번에 보이므로 진행 안내를 찍지 않는다.
 */
function loginViaLoopback(
  apiBaseUrl: string,
  provider: Provider | undefined,
  quiet: boolean,
): Promise<string | null> {
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

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const token = url.searchParams.get("token");
      res.setHeader("content-type", "text/html; charset=utf-8");
      const valid = Boolean(token) && await validateUserToken({ apiBaseUrl }, token!);
      res.statusCode = valid ? 200 : 401;
      res.end(RESULT_HTML(valid));
      if (valid) done(token);
    });
    server.on("error", () => done(null));

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const url = `${apiBaseUrl}${loginPath(provider)}?cli_port=${port}`;
      if (!quiet) {
        console.log(t("login.openBrowser", { provider: providerLabel(provider) }));
        console.log(`  ${url}\n`);
      }
      openBrowser(url);
    });
  });
}

/**
 * 소셜 로그인(GitHub/Google) — 루프백 자동 수신, 실패 시 수동 붙여넣기 폴백.
 * `--github` / `--google`로 방식을 고정하고, 없으면 브라우저에서 고른다.
 * `--quiet`: /pinglet-login slash command용 — 터미널 입력을 받을 수 없으므로
 * 붙여넣기 폴백 대신 안내만 출력하고, 실패해도 exit 0 (에러 덤프 방지).
 * 약관 동의 안내는 브라우저의 로그인 선택 페이지가 대신 보여준다.
 */
export async function runLogin(args: string[]): Promise<void> {
  const config = loadConfig();
  const quiet = args.includes("--quiet");

  let token: string | undefined;
  const tokenIndex = args.indexOf("--token");
  if (tokenIndex !== -1 && args[tokenIndex + 1]) {
    token = args[tokenIndex + 1];
  }
  const provider: Provider | undefined = args.includes("--google")
    ? "google"
    : args.includes("--github")
      ? "github"
      : undefined;

  if (!token) {
    if (!quiet) console.log(t("login.terms", { api: config.apiBaseUrl }));
    token =
      (await loginViaLoopback(config.apiBaseUrl, provider, quiet)) ?? undefined;
    if (!token && quiet) {
      console.log(t("login.quietFailed"));
      return;
    }
    if (!token) {
      // SSH 등 브라우저와 터미널이 다른 기계인 경우를 위한 폴백.
      console.log(t("login.fallback"));
      console.log(`  ${config.apiBaseUrl}${loginPath(provider)}\n`);
      token = (await prompt("token: ")).trim();
    }
  }

  if (!token) {
    console.log(t("login.emptyToken"));
    if (!quiet) process.exitCode = 1;
    return;
  }

  if (!await validateUserToken(config, token)) {
    console.log(t("login.invalidToken"));
    if (!quiet) process.exitCode = 1;
    return;
  }
  if (config.userToken && config.userToken !== token) {
    if (!await releaseCredential(config, "user", config.userToken)) {
      throw new Error(t("logout.failed"));
    }
  }
  config.userToken = token;
  saveConfig(config);
  console.log(t("login.saved"));

  for (const [agentType, record] of Object.entries(config.installations)) {
    const linked = await linkInstallation(config, record.token);
    console.log(
      linked
        ? t("login.linked", { agent: agentType })
        : t("login.linkFailed", { agent: agentType }),
    );
  }
}
