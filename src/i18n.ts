import { detectLocale, DisplayLocale } from "./render";

/**
 * CLI 안내 문구 다국어 테이블. 시스템 언어가 한국어면 ko, 일본어면 ja, 그 외는 en.
 * (판정 기준은 statusline과 동일 — render.detectLocale)
 * 값이 함수면 파라미터를 받아 문장을 만든다.
 */
type P = Record<string, string | number>;
type Msg = string | ((p: P) => string);

const en = {
  // ---- cli
  "cli.help": (p: P) => `pinglet v${p.version} — a developer message network you meet while the AI thinks

Usage: pinglet <command>

  install [--api <url>] [--force]   Install the Claude Code integration
          [--claude | --codex]      Codex uses OS notifications; opt in with --codex (experimental)
  uninstall [--purge]               Restore settings and revoke credentials (--purge: delete ~/.pinglet)
  login [--github | --google]       Link your account (GitHub or Google; pick in the browser if omitted)
        [--token <jwt>]
  logout                            Sign out (keeps the integration and cache)
                                    (inside Claude Code: /pinglet-login, /pinglet-logout)
  post "message" [--category <c>]   Post a message (login required; reading is anonymous)
  doctor                            Diagnose install / cache / server status
  ping                              Preview a message

Internal commands (called by the integration):
  statusline                        Claude Code statusLine hook
  notify                            Codex notify hook
  flush                             Send the event queue in batches
  refresh                           Refresh the feed cache + heartbeat
`,
  "cli.firstSetup": "pinglet: not set up yet — starting first-time setup.",

  // ---- login
  "login.terms": (p: P) =>
    `\nBy logging in you agree to the Terms (${p.api}/terms) and Privacy Policy (${p.api}/privacy).`,
  "login.anyProvider": "GitHub or Google",
  "login.openBrowser": (p: P) => `Complete the ${p.provider} login in your browser…`,
  "login.quietFailed":
    "✗ Login was not completed (3-minute limit). Run `pinglet login` in a terminal to try again.",
  "login.fallback":
    "Automatic login failed. Log in at the URL below and paste the token value from the JSON response.",
  "login.emptyToken": "✗ token is empty.",
  "login.saved": "✓ Login saved",
  "login.linked": (p: P) => `✓ Linked the ${p.agent} installation to your account`,
  "login.linkFailed": (p: P) =>
    `○ Failed to link the ${p.agent} installation — retry once the server is reachable`,
  "login.html.ok": "💌 Logged in",
  "login.html.okSub": "You can close this window and return to the terminal.",
  "login.html.fail": "✗ Login failed",
  "login.html.failSub": "Please try again from the terminal.",

  // ---- logout
  "logout.notLoggedIn": "○ You are not logged in.",
  "logout.failed": "Server sign-out failed. Credentials are preserved; retry pinglet logout when connected.",
  "uninstall.failed": "Server revocation failed. Local data is preserved; retry pinglet uninstall when connected.",
  "uninstall.npm": "To remove the CLI package too, run: npm uninstall -g pinglet-cli (npm itself is kept).",
  "login.invalidToken": "Login could not be verified. Existing credentials were preserved; check your token and connection.",
  "logout.done": "✓ Logged out. Reading still works; run `pinglet login` again to post.",

  // ---- post
  "reason.EMPTY": "empty messages cannot be posted",
  "reason.TOO_LONG": "message is too long (100 characters by default)",
  "reason.URL_NOT_ALLOWED": "URLs are not allowed",
  "reason.PII_DETECTED": "contains personal data such as an email or phone number",
  "reason.BANNED_WORD": "contains wording that needs policy review",
  "reason.CONTROL_CHARS": "control characters (escape sequences) are not allowed",
  "post.emptyQuiet": "✗ The message is empty. Write your message after /pinglet.",
  "post.usage": 'Usage: pinglet post "message" [--category <category>]',
  "post.loginRequired": (p: P) =>
    `✗ Posting requires a login (GitHub or Google). Run \`${p.cmd}\` (reading works without login).`,
  "post.expired": (p: P) => `✗ Your login has expired. Run \`${p.cmd}\` to log in again.`,
  "post.rateLimited": "✗ Posting limit reached (5 per minute). Try again shortly.",
  "post.network": (p: P) => `✗ Cannot reach the server (${p.api}).`,
  "post.failed": "✗ Failed to post the message.",
  "post.approved": "✓ Message posted. It will show up in other developers' terminals soon.",
  "post.pending": (p: P) => `○ Message is pending review${p.reason ? ` — ${p.reason}` : ""}.`,
  "post.pendingNote": "  It will appear in the feed once approved.",
  "post.rejected": (p: P) => `✗ Message rejected${p.reason ? ` — ${p.reason}` : ""}.`,

  // ---- install
  "install.codexOptOut":
    "○ Codex detected — excluded from the default install because it uses OS notifications (opt in with pinglet install --codex)",
  "install.noTarget": "\nNothing to install. Please install Claude Code or Codex first.",
  "install.offline": (p: P) =>
    `○ Cannot reach the Pinglet server (${p.api}); installing in offline mode.`,
  "install.offlineNote": "  Server registration and feed sync will retry automatically once online.",
  "install.askReplaceStatusLine":
    "  An existing statusLine setting was found. Back it up and replace it? (restored on uninstall) (Y/n) ",
  "install.askReplaceNotify":
    "  An existing notify setting was found. Back it up and replace it? (restored on uninstall) (Y/n) ",
  "install.or": " or ",
  "install.done": (p: P) => `\nAll set! Run ${p.targets} as usual and Pings will appear.`,
  "install.doneDoctor": "  Check status:  pinglet doctor",
  "install.donePost": '  Post:          pinglet login, then pinglet post "message"',
  "install.doneLogin": "  Link account:  pinglet login  (required to post / react)",

  // ---- doctor
  "doctor.nodeOld": (p: P) => `Node.js ${p.version} — 18 or newer is required`,
  "doctor.spinnerCount": (p: P) => `Spinner messages: ${p.n} registered`,
  "doctor.spinnerMissing": "No spinner message registered — run `pinglet refresh`",
  "doctor.claudeNotInstalled": "Claude integration not installed — run `pinglet install`",
  "doctor.codexNotInstalled": "Codex integration not installed — run `pinglet install`",
  "doctor.noInstallation": "No installation registered on the server (offline install)",
  "doctor.feedEmpty": "Feed cache is empty — showing the default spinner (Pings appear after the feed arrives)",
  "doctor.feedCache": (p: P) => `Feed cache: ${p.n} messages (updated ${p.min} min ago)`,
  "doctor.queue": (p: P) => `Event queue: ${p.n} pending`,
  "doctor.queueBacklog": (p: P) => `Event queue: ${p.n} pending — uploads are falling behind`,
  "doctor.apiUnreachable": (p: P) => `API unreachable (${p.api}) — running in offline mode`,
  "doctor.loggedIn": "Logged in",
  "doctor.notLoggedIn": "Not logged in — reading works; run `pinglet login` to post / react",

  // ---- misc commands
  "uninstall.keep": "○ Local cache and history are kept. Use --purge to delete ~/.pinglet too.",
  "ping.none": "No Ping to show — one will appear once the feed is received.",
  "postinstall.start": "\npinglet: running first-time setup automatically (`pinglet install`)",
  "postinstall.failed": "pinglet: automatic setup failed. Please run `pinglet install` yourself.",

  // ---- adapters
  "claude.existingStatusLine": "An existing statusLine setting was found (use --force to back it up and replace).",
  "claude.settingsBusy": "settings.json keeps changing; could not install. Try again shortly.",
  "codex.existingNotify": "An existing notify setting was found (use --force to back it up and replace).",
  "slash.postDesc": "Post a message to Pinglet so it shows in other developers' terminals",
  "slash.loginDesc": "Link your Pinglet account (GitHub or Google login in the browser; --github/--google to choose)",
  "slash.logoutDesc": "Sign out of Pinglet (revoke this session and unlink this device)",
} satisfies Record<string, Msg>;

export type MessageKey = keyof typeof en;

const ko: Record<MessageKey, Msg> = {
  "cli.help": (p) => `pinglet v${p.version} — AI가 생각하는 동안 만나는 개발자 메시지 네트워크

사용법: pinglet <command>

  install [--api <url>] [--force]   Claude Code integration 설치
          [--claude | --codex]      Codex는 OS 알림 방식이라 --codex로 opt-in (experimental)
  uninstall [--purge]               설정 복원·서버 인증 해제 (--purge: ~/.pinglet까지 삭제)
  login [--github | --google]       계정 연결 (GitHub 또는 Google, 생략 시 브라우저에서 선택)
        [--token <jwt>]
  logout                            로그인 해제 (설치·캐시는 유지)
                                    (Claude Code 안에서는 /pinglet-login, /pinglet-logout)
  post "메시지" [--category <c>]     메시지 작성 (로그인 필요, 읽기는 익명 가능)
  doctor                            설치/캐시/서버 상태 진단
  ping                              메시지 미리보기

내부 명령 (integration이 호출):
  statusline                        Claude Code statusLine hook
  notify                            Codex notify hook
  flush                             이벤트 큐 batch 전송
  refresh                           feed 캐시 갱신 + heartbeat
`,
  "cli.firstSetup": "pinglet: 아직 설정 전입니다 — 첫 설정을 시작합니다.",

  "login.terms": (p) =>
    `\n로그인하면 이용약관(${p.api}/terms)과 개인정보처리방침(${p.api}/privacy)에 동의하는 것으로 간주됩니다.`,
  "login.anyProvider": "GitHub 또는 Google",
  "login.openBrowser": (p) => `브라우저에서 ${p.provider} 로그인을 완료해 주세요…`,
  "login.quietFailed":
    "✗ 로그인이 완료되지 않았습니다 (제한 시간 3분). 터미널에서 `pinglet login`으로 다시 시도하세요.",
  "login.fallback":
    "자동 로그인에 실패했습니다. 아래 URL에서 로그인 후 응답 JSON의 token 값을 붙여넣어 주세요.",
  "login.emptyToken": "✗ token이 비어 있습니다.",
  "login.saved": "✓ 로그인 정보 저장 완료",
  "login.linked": (p) => `✓ ${p.agent} installation을 계정에 연결했습니다`,
  "login.linkFailed": (p) => `○ ${p.agent} installation 연결 실패 — 서버 연결 후 다시 시도하세요`,
  "login.html.ok": "💌 로그인 완료",
  "login.html.okSub": "이 창을 닫고 터미널로 돌아가세요.",
  "login.html.fail": "✗ 로그인 실패",
  "login.html.failSub": "터미널에서 다시 시도해 주세요.",

  "logout.notLoggedIn": "○ 로그인 상태가 아닙니다.",
  "logout.failed": "서버 로그아웃에 실패했습니다. 재시도할 수 있도록 인증 정보를 보존했습니다. 연결 후 pinglet logout을 다시 실행하세요.",
  "uninstall.failed": "서버 인증 해제에 실패해 로컬 데이터를 보존했습니다. 연결 후 pinglet uninstall을 다시 실행하세요.",
  "uninstall.npm": "CLI 패키지도 제거하려면: npm uninstall -g pinglet-cli (npm 자체는 유지됩니다).",
  "login.invalidToken": "로그인을 확인할 수 없습니다. 기존 인증 정보는 보존했습니다. 토큰과 서버 연결을 확인하세요.",
  "logout.done": "✓ 로그아웃했습니다. 읽기는 계속 되고, 메시지 작성은 `pinglet login` 후 가능합니다.",

  "reason.EMPTY": "빈 메시지는 등록할 수 없습니다",
  "reason.TOO_LONG": "메시지가 너무 깁니다 (기본 100자 제한)",
  "reason.URL_NOT_ALLOWED": "URL은 허용되지 않습니다",
  "reason.PII_DETECTED": "이메일/전화번호 등 개인정보가 포함되어 있습니다",
  "reason.BANNED_WORD": "정책상 검토가 필요한 표현이 포함되어 있습니다",
  "reason.CONTROL_CHARS": "제어 문자(escape sequence)는 허용되지 않습니다",
  "post.emptyQuiet": "✗ 메시지가 비어 있습니다. /pinglet 뒤에 보낼 메시지를 적어주세요.",
  "post.usage": '사용법: pinglet post "메시지" [--category <카테고리>]',
  "post.loginRequired": (p) =>
    `✗ 메시지 작성에는 로그인(GitHub 또는 Google)이 필요합니다. \`${p.cmd}\`을 실행하세요 (읽기는 로그인 없이 가능).`,
  "post.expired": (p) => `✗ 로그인이 만료됐습니다. \`${p.cmd}\`으로 다시 로그인하세요.`,
  "post.rateLimited": "✗ 작성 제한(분당 5개)에 걸렸습니다. 잠시 후 다시 시도하세요.",
  "post.network": (p) => `✗ 서버(${p.api})에 연결할 수 없습니다.`,
  "post.failed": "✗ 메시지 등록에 실패했습니다.",
  "post.approved": "✓ 메시지가 등록됐습니다. 곧 다른 개발자들의 터미널에 표시됩니다.",
  "post.pending": (p) => `○ 메시지가 검토 대기 중입니다${p.reason ? ` — ${p.reason}` : ""}.`,
  "post.pendingNote": "  승인되면 feed에 노출됩니다.",
  "post.rejected": (p) => `✗ 메시지가 거절됐습니다${p.reason ? ` — ${p.reason}` : ""}.`,

  "install.codexOptOut":
    "○ Codex 감지됨 — OS 알림 방식이라 기본 설치에서 제외합니다 (원하면 pinglet install --codex)",
  "install.noTarget": "\n설치할 대상이 없습니다. Claude Code 또는 Codex를 먼저 설치해 주세요.",
  "install.offline": (p) => `○ Pinglet 서버(${p.api})에 연결할 수 없어 오프라인 모드로 설치합니다.`,
  "install.offlineNote": "  서버 등록과 feed 수신은 온라인 상태가 되면 자동으로 재시도됩니다.",
  "install.askReplaceStatusLine":
    "  기존 statusLine 설정이 있습니다. 백업 후 교체할까요? (uninstall 시 복원) (Y/n) ",
  "install.askReplaceNotify":
    "  기존 notify 설정이 있습니다. 백업 후 교체할까요? (uninstall 시 복원) (Y/n) ",
  "install.or": " 또는 ",
  "install.done": (p) => `\n설치 완료! 평소처럼 ${p.targets}를 실행하면 Ping이 표시됩니다.`,
  "install.doneDoctor": "  상태 확인:   pinglet doctor",
  "install.donePost": '  메시지 작성: pinglet login 후 pinglet post "메시지"',
  "install.doneLogin": "  계정 연결:   pinglet login  (메시지 작성/반응에 필요)",

  "doctor.nodeOld": (p) => `Node.js ${p.version} — 18 이상이 필요합니다`,
  "doctor.spinnerCount": (p) => `Spinner 메시지: ${p.n}개 등록됨`,
  "doctor.spinnerMissing": "Spinner 메시지 미등록 — `pinglet refresh` 실행",
  "doctor.claudeNotInstalled": "Claude integration not installed — `pinglet install` 실행",
  "doctor.codexNotInstalled": "Codex integration not installed — `pinglet install` 실행",
  "doctor.noInstallation": "서버에 등록된 installation이 없습니다 (오프라인 설치 상태)",
  "doctor.feedEmpty": "Feed cache 비어 있음 — 기본 spinner로 표시 중 (서버 feed 수신 후 Ping 표시)",
  "doctor.feedCache": (p) => `Feed cache: ${p.n}개 (${p.min}분 전 갱신)`,
  "doctor.queue": (p) => `Event queue: ${p.n}개 대기`,
  "doctor.queueBacklog": (p) => `Event queue: ${p.n}개 대기 — 서버 전송이 밀려 있습니다`,
  "doctor.apiUnreachable": (p) => `API unreachable (${p.api}) — 오프라인 모드로 동작 중`,
  "doctor.loggedIn": "로그인됨",
  "doctor.notLoggedIn": "로그인 안 됨 — 읽기는 가능, 메시지 작성/반응은 `pinglet login` 후",

  "uninstall.keep": "○ 로컬 캐시·기록은 유지됩니다. ~/.pinglet도 지우려면 --purge를 사용하세요.",
  "ping.none": "표시할 Ping이 없습니다 — 서버 feed를 받으면 표시됩니다.",
  "postinstall.start": "\npinglet: 첫 설정을 자동으로 진행합니다 (`pinglet install`)",
  "postinstall.failed": "pinglet: 자동 설정에 실패했습니다. `pinglet install`을 직접 실행해 주세요.",

  "claude.existingStatusLine": "기존 statusLine 설정이 있습니다 (백업 후 교체하려면 --force).",
  "claude.settingsBusy": "settings.json이 계속 변경되고 있어 설치하지 못했습니다. 잠시 후 다시 시도하세요.",
  "codex.existingNotify": "기존 notify 설정이 있습니다 (백업 후 교체하려면 --force).",
  "slash.postDesc": "메시지를 Pinglet에 등록해 다른 개발자들의 터미널에 표시",
  "slash.loginDesc": "Pinglet 계정 연결 (브라우저에서 GitHub 또는 Google 로그인, --github/--google로 지정 가능)",
  "slash.logoutDesc": "Pinglet 로그인 해제 (서버 세션 폐기·이 기기의 계정 연결 해제)",
};

const ja: Record<MessageKey, Msg> = {
  "cli.help": (p) => `pinglet v${p.version} — AIが考えている間に出会う開発者メッセージネットワーク

使い方: pinglet <command>

  install [--api <url>] [--force]   Claude Code integration をインストール
          [--claude | --codex]      Codex は OS 通知方式のため --codex で opt-in (experimental)
  uninstall [--purge]               設定を復元・認証を解除 (--purge: ~/.pinglet も削除)
  login [--github | --google]       アカウント連携 (GitHub または Google、省略時はブラウザで選択)
        [--token <jwt>]
  logout                            ログアウト (連携設定・キャッシュは維持)
                                    (Claude Code 内では /pinglet-login, /pinglet-logout)
  post "メッセージ" [--category <c>]  メッセージ投稿 (ログイン必要、閲覧は匿名可)
  doctor                            インストール/キャッシュ/サーバー状態を診断
  ping                              メッセージのプレビュー

内部コマンド (integration が呼び出す):
  statusline                        Claude Code statusLine hook
  notify                            Codex notify hook
  flush                             イベントキューをバッチ送信
  refresh                           feed キャッシュ更新 + heartbeat
`,
  "cli.firstSetup": "pinglet: まだ設定されていません — 初期設定を開始します。",

  "login.terms": (p) =>
    `\nログインすると利用規約(${p.api}/terms)とプライバシーポリシー(${p.api}/privacy)に同意したものとみなされます。`,
  "login.anyProvider": "GitHub または Google",
  "login.openBrowser": (p) => `ブラウザで ${p.provider} ログインを完了してください…`,
  "login.quietFailed":
    "✗ ログインが完了しませんでした (制限時間3分)。ターミナルで `pinglet login` を実行して再試行してください。",
  "login.fallback":
    "自動ログインに失敗しました。以下の URL でログイン後、レスポンス JSON の token の値を貼り付けてください。",
  "login.emptyToken": "✗ token が空です。",
  "login.saved": "✓ ログイン情報を保存しました",
  "login.linked": (p) => `✓ ${p.agent} installation をアカウントに連携しました`,
  "login.linkFailed": (p) => `○ ${p.agent} installation の連携に失敗 — サーバー接続後に再試行してください`,
  "login.html.ok": "💌 ログイン完了",
  "login.html.okSub": "このウィンドウを閉じてターミナルに戻ってください。",
  "login.html.fail": "✗ ログイン失敗",
  "login.html.failSub": "ターミナルからもう一度お試しください。",

  "logout.notLoggedIn": "○ ログインしていません。",
  "logout.failed": "サーバーのログアウトに失敗しました。認証情報は保持しています。接続後に pinglet logout を再実行してください。",
  "uninstall.failed": "サーバーの認証解除に失敗したため、ローカルデータを保持しました。接続後に pinglet uninstall を再実行してください。",
  "uninstall.npm": "CLI パッケージも削除するには: npm uninstall -g pinglet-cli（npm 本体は保持されます）。",
  "login.invalidToken": "ログインを確認できませんでした。既存の認証情報は保持しています。トークンと接続を確認してください。",
  "logout.done": "✓ ログアウトしました。閲覧は引き続き可能で、投稿は `pinglet login` 後にできます。",

  "reason.EMPTY": "空のメッセージは投稿できません",
  "reason.TOO_LONG": "メッセージが長すぎます (デフォルト100文字まで)",
  "reason.URL_NOT_ALLOWED": "URL は許可されていません",
  "reason.PII_DETECTED": "メールアドレス/電話番号などの個人情報が含まれています",
  "reason.BANNED_WORD": "ポリシー上の確認が必要な表現が含まれています",
  "reason.CONTROL_CHARS": "制御文字 (escape sequence) は許可されていません",
  "post.emptyQuiet": "✗ メッセージが空です。/pinglet の後に送るメッセージを書いてください。",
  "post.usage": '使い方: pinglet post "メッセージ" [--category <カテゴリ>]',
  "post.loginRequired": (p) =>
    `✗ 投稿にはログイン (GitHub または Google) が必要です。\`${p.cmd}\` を実行してください (閲覧はログイン不要)。`,
  "post.expired": (p) => `✗ ログインの有効期限が切れました。\`${p.cmd}\` で再度ログインしてください。`,
  "post.rateLimited": "✗ 投稿制限 (1分あたり5件) に達しました。しばらくしてから再試行してください。",
  "post.network": (p) => `✗ サーバー (${p.api}) に接続できません。`,
  "post.failed": "✗ メッセージの投稿に失敗しました。",
  "post.approved": "✓ メッセージを投稿しました。まもなく他の開発者のターミナルに表示されます。",
  "post.pending": (p) => `○ メッセージは審査待ちです${p.reason ? ` — ${p.reason}` : ""}。`,
  "post.pendingNote": "  承認されると feed に表示されます。",
  "post.rejected": (p) => `✗ メッセージは拒否されました${p.reason ? ` — ${p.reason}` : ""}。`,

  "install.codexOptOut":
    "○ Codex を検出 — OS 通知方式のためデフォルトのインストールからは除外します (必要なら pinglet install --codex)",
  "install.noTarget": "\nインストール対象がありません。先に Claude Code または Codex をインストールしてください。",
  "install.offline": (p) => `○ Pinglet サーバー (${p.api}) に接続できないため、オフラインモードでインストールします。`,
  "install.offlineNote": "  サーバー登録と feed の受信はオンラインになると自動的に再試行されます。",
  "install.askReplaceStatusLine":
    "  既存の statusLine 設定があります。バックアップして置き換えますか? (uninstall 時に復元) (Y/n) ",
  "install.askReplaceNotify":
    "  既存の notify 設定があります。バックアップして置き換えますか? (uninstall 時に復元) (Y/n) ",
  "install.or": " または ",
  "install.done": (p) => `\nインストール完了! いつも通り ${p.targets} を実行すると Ping が表示されます。`,
  "install.doneDoctor": "  状態確認:       pinglet doctor",
  "install.donePost": '  メッセージ投稿: pinglet login の後に pinglet post "メッセージ"',
  "install.doneLogin": "  アカウント連携: pinglet login  (投稿/リアクションに必要)",

  "doctor.nodeOld": (p) => `Node.js ${p.version} — 18 以上が必要です`,
  "doctor.spinnerCount": (p) => `Spinner メッセージ: ${p.n}件登録済み`,
  "doctor.spinnerMissing": "Spinner メッセージ未登録 — `pinglet refresh` を実行",
  "doctor.claudeNotInstalled": "Claude integration not installed — `pinglet install` を実行",
  "doctor.codexNotInstalled": "Codex integration not installed — `pinglet install` を実行",
  "doctor.noInstallation": "サーバーに登録された installation がありません (オフラインインストール状態)",
  "doctor.feedEmpty": "Feed cache が空です — デフォルトの spinner を表示中 (サーバーから feed を受信すると Ping を表示)",
  "doctor.feedCache": (p) => `Feed cache: ${p.n}件 (${p.min}分前に更新)`,
  "doctor.queue": (p) => `Event queue: ${p.n}件待機中`,
  "doctor.queueBacklog": (p) => `Event queue: ${p.n}件待機中 — サーバーへの送信が滞っています`,
  "doctor.apiUnreachable": (p) => `API unreachable (${p.api}) — オフラインモードで動作中`,
  "doctor.loggedIn": "ログイン済み",
  "doctor.notLoggedIn": "未ログイン — 閲覧は可能、投稿/リアクションは `pinglet login` 後",

  "uninstall.keep": "○ ローカルキャッシュと履歴は保持されます。~/.pinglet も削除するには --purge を使ってください。",
  "ping.none": "表示する Ping がありません — サーバーから feed を受信すると表示されます。",
  "postinstall.start": "\npinglet: 初期設定を自動的に行います (`pinglet install`)",
  "postinstall.failed": "pinglet: 自動設定に失敗しました。`pinglet install` を手動で実行してください。",

  "claude.existingStatusLine": "既存の statusLine 設定があります (バックアップして置き換えるには --force)。",
  "claude.settingsBusy": "settings.json が変更され続けているためインストールできませんでした。しばらくしてから再試行してください。",
  "codex.existingNotify": "既存の notify 設定があります (バックアップして置き換えるには --force)。",
  "slash.postDesc": "メッセージを Pinglet に投稿して他の開発者のターミナルに表示",
  "slash.loginDesc": "Pinglet アカウント連携 (ブラウザで GitHub または Google ログイン、--github/--google で指定可)",
  "slash.logoutDesc": "Pinglet ログアウト (サーバーセッション失効・この端末のアカウント連携解除)",
};

const tables: Record<DisplayLocale, Record<MessageKey, Msg>> = { en, ko, ja };

export function t(key: MessageKey, params: P = {}): string {
  const table = tables[detectLocale()] ?? en;
  const msg = table[key] ?? en[key];
  return typeof msg === "function" ? msg(params) : msg;
}

/** HTML lang 속성 등에 쓰는 현재 표시 언어. */
export function currentLocale(): DisplayLocale {
  return detectLocale();
}
