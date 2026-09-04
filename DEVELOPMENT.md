# Pinglet Client — 개발 문서

> 사용자용 안내는 [README.md](README.md) 참고.

AI가 생각하는 동안 다른 개발자의 Ping을 만나는 메시지 네트워크 — 로컬 런타임(CLI).

`pinglet-backend`(NestJS)와 연동되며, 한 번 설치하면 평소처럼 `claude` / `codex`를
실행하기만 해도 대기 구간에 다른 개발자의 짧은 메시지가 표시된다.

## 설치 및 사용

```bash
npm install -g pinglet-cli   # 설치 후 명령어는 `pinglet`
```

npm 글로벌 설치 시 postinstall이 `pinglet install`까지 자동 수행한다.
(pnpm/bun처럼 postinstall을 차단하는 매니저에서는 `pinglet install`을 직접 실행)

제거할 때는 반드시 integration 정리를 먼저 한다 — npm은 uninstall 시
스크립트를 실행하지 않으므로 순서가 바뀌면 설정이 남는다:

```bash
pinglet uninstall
npm uninstall -g pinglet-cli
```

개발 시에는 로컬 백엔드에 연결한다:

```bash
npm install
npm run build

# 개발 중 로컬 백엔드에 연결
node dist/cli.js install --api http://localhost:3000

# 이후 평소처럼
claude   # statusline에 💌 Ping 표시
codex    # turn 완료 시 macOS 알림으로 Ping 전달 (experimental)
```

| 명령 | 설명 |
|---|---|
| `pinglet install [--api <url>] [--force]` | Claude Code / Codex 자동 감지 후 integration 설치 + 서버 등록 + 초기 feed 캐시 |
| `pinglet uninstall [--purge]` | integration 제거, 기존 설정 복원. `--purge`는 `~/.pinglet`까지 삭제 |
| `pinglet login [--token <jwt>]` | GitHub 로그인 후 익명 설치를 계정에 연결 |
| `pinglet post "메시지" [--category <c>]` | 메시지 작성 (GitHub 로그인 필요, 읽기는 로그인 없이 가능) |
| `pinglet doctor` | 설치/캐시/큐/서버 상태 진단 |
| `pinglet ping` | 메시지 미리보기 (이벤트 기록 없음) |

내부 명령(integration이 호출): `statusline`, `notify`, `flush`, `refresh`

### 세션 안에서 바로 작성

Claude Code 세션에서 `/pinglet 메시지`를 입력하면 등록된다.
install 시 `~/.claude/commands/pinglet.md` slash command가 함께 설치되며,
등록 자체는 command 안의 인라인 bash 실행(`pinglet post`)이 수행하고
모델은 결과 한 줄만 전달하므로 토큰 사용이 매우 적다.

```
> /pinglet 금요일 오후 배포는 다음 생에 합시다.
```

## Integration 방식

- **Claude Adapter** — `~/.claude/settings.json`의 `statusLine` hook에
  `node <cli> statusline`을 연결한다. statusline은 UI 영역이라 LLM context에
  전혀 들어가지 않으며(Zero Token), Thinking/Working 중에 메시지가 보인다.
  기존 statusLine 설정은 백업 후 uninstall 시 복원한다.
  - **Spinner verbs (pool=1 회전)** — `spinnerVerbs`(mode: "replace")에 메시지를
    **한 번에 하나만** 등록해 "Befuddling…" 자리에 Ping이 표시된다. statusline이
    60초마다 다음 메시지로 교체하며, Claude Code가 설정을 핫리로드하므로 세션
    중에도 즉시 반영된다. pool이 1개라 "spinner가 돌았다 = 이 메시지가 표시됐다"가
    확정된다. Pinglet verb는 zero-width space 마커로 식별하므로 사용자가 직접
    등록한 verb는 건드리지 않고, uninstall 시 원래대로 복원한다.
- **Codex Adapter (experimental)** — `~/.codex/config.toml`의 `notify` hook에 연결.
  notify는 TUI 밖 프로세스라 터미널 안에 그릴 수 없어, MVP에서는 turn 완료 시
  macOS 알림으로 전달한다.

## 아키텍처 원칙 구현

- **Local-first Rendering** — 서버 feed를 30~50개 미리 받아 `~/.pinglet/feed.json`에
  캐시하고, 렌더링 순간에는 로컬 파일만 동기 I/O로 읽는다. 렌더링 path에
  네트워크가 절대 들어가지 않는다.
- **오프라인 동작** — 서버 미연결 시 시드 메시지로 동작하고, 등록/feed 갱신은
  백그라운드 `refresh`가 온라인이 되면 자동 재시도한다.
- **DELIVERED / QUALIFIED_IMPRESSION 분리** — 메시지가 spinner에 armed되면
  DELIVERED(설치당 1회), armed된 동안 spinner가 3초 이상 실제로 돌았으면
  QUALIFIED_IMPRESSION(visibleMs 포함)으로 정산한다. "실제로 돌았는지"는
  statusline hook이 받는 `cost.total_api_duration_ms` 증가분으로 측정한다 —
  pool이 1개이므로 API 활동 시간만큼 그 메시지가 표시된 것이 확정된다.
- **Async Telemetry** — 이벤트는 `~/.pinglet/events.jsonl`(Local Event Queue)에
  append하고, 20개 이상 또는 60초 주기로 detached 프로세스가 batch 전송한다.
  전송 성공분만 큐에서 제거하므로 실패분은 자동 재시도되며, 재전송 중복은
  서버가 `eventId`로 dedupe한다.
- **Privacy** — prompt/응답/코드/환경변수를 읽지 않는다. 수집하는 것은
  installationId, agentType, OS, clientVersion, 메시지 delivery 이벤트뿐이다.

## 백엔드 API 사용 (pinglet-backend)

| 엔드포인트 | 용도 |
|---|---|
| `POST /installations` | agent별 익명 설치 등록 → `{installationId, token}` |
| `GET /feed?limit=50` | 로컬 캐시용 feed 수신 (installation JWT) |
| `POST /events/batch` | 이벤트 batch 전송 (최대 200개, eventId dedupe) |
| `POST /messages` | 메시지 작성 (`post` 명령, 유저 JWT 또는 installation JWT) |
| `POST /installations/heartbeat` | lastSeenAt 갱신 |
| `POST /installations/link` | 로그인 후 설치를 계정에 연결 |
| `GET /auth/github` | GitHub OAuth 시작 (login 명령이 브라우저로 연다) |

## 로컬 파일

```
~/.pinglet/
  config.json    # apiBaseUrl, agent별 installation 토큰, adapter 설치 정보
  feed.json      # Local Feed Cache
  state.json     # 현재 표시 중 메시지, seen 카운트, flush/refresh 타이밍
  events.jsonl   # Local Event Queue (append-only)
```

## 안내 문구 언어

CLI가 출력하는 안내 문구는 `src/i18n.ts`의 테이블(ko/ja/en)에서 가져온다.
언어 판정은 statusline과 같은 `detectLocale()`(시스템 언어 → 타임존 순)이며,
한국어·일본어 외에는 전부 영어다. 새 문구를 추가할 때는 세 언어 모두 채운다.
슬래시 명령 파일의 `description`도 설치 시점의 언어로 생성된다.
