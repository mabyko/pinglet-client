# Pinglet 💌

**AI가 생각하는 동안, 다른 개발자의 한 줄을 만나세요.**

Claude Code가 코드를 고치는 동안 "Befuddling…" 스피너만 바라보던 그 자리에,
다른 개발자들이 남긴 짧은 메시지(**Ping**)가 대신 표시됩니다.

![Pinglet 데모 — Claude Code 스피너 자리에 다른 개발자의 Ping이 표시된다](docs/pinglet-demo.gif)

```
✶ 💌 "금요일 오후 배포는 다음 생에 합시다." (12s · ↓ 1.2k tokens)
```

🌐 **홈페이지**: https://pinglet.halluci.co.kr

🇺🇸 [English](./README.md) · 🇯🇵 [日本語](./README.ja.md)

## 시작하기

```bash
npm install -g pinglet-cli && pinglet install
```

이게 전부입니다. 이후는 평소처럼 `claude`를 실행하기만 하면 돼요.

> 설치 중 npm이 `install-scripts` 경고를 보여줄 수 있습니다 — 구버전 npm에서
> 초기 설정을 자동화하던 스크립트에 대한 안내로, 무시해도 됩니다.
> 연결 상태는 `pinglet doctor`로 언제든 확인할 수 있어요.

- 기존 statusline 설정이 있다면 **백업 후 교체할지 물어보고**, 제거 시 원래대로 복원합니다.
- Codex도 지원합니다(experimental) — turn 완료 시 macOS 알림으로 Ping이 도착합니다.
  알림 방식이 시끄러울 수 있어 기본 설치에서는 제외되며, 원할 때만 `pinglet install --codex`로 켜세요.

## Ping 보내기

Claude Code 세션 안에서 바로:

```
> /pinglet-login                      # 최초 1회 — 브라우저에서 GitHub 또는 Google 로그인
> /pinglet 오늘도 빌드가 초록불이길
> /pinglet-logout                     # 이 기기의 로그인 해제
```

또는 터미널에서:

```bash
pinglet login          # GitHub 또는 Google 로그인 — 브라우저가 열리고 자동으로 완료됩니다 (최초 1회)
pinglet post "메시지"
```

읽기는 로그인 없이 가능하고, **작성에만 로그인(GitHub 또는 Google)이 필요합니다.**

지금 몇 개의 터미널이 함께 켜져 있는지는 statusline에서 보여줍니다:

```
🟢 지금 41개 터미널과 함께 코딩 중
```

statusline 언어는 시스템 언어에 따라 자동 선택됩니다(한국어/일본어, 그 외는 영어). 시스템 언어로 판정이 안 되면 타임존(서울/도쿄)으로 추정합니다.

## HUD — 세션 정보를 statusline에

"함께 코딩 중" 줄 아래에 [claude-hud](https://github.com/jarrodwatts/claude-hud)와 같은 방식의 HUD가 표시됩니다.
모델과 effort 레벨, 프로젝트·git 브랜치(변경 줄 수·푸시 안 한 커밋), `/advisor` 자문 모델, 세션 시간·비용·출력 속도,
컨텍스트 사용률 바, 5시간/7일/모델별 주간 사용량 한도, prompt cache 만료 시각, 기기 RAM 사용률,
지금 도는 도구·호출한 스킬·서브 에이전트·todo 진행률, 변경 파일 목록, 세션 누적 토큰, 압축 횟수입니다.

```
🟢 지금 41개 터미널과 함께 코딩 중
[Opus 5 ◑ high] │ my-project git:(main* ↑2 [+337 -29]) │ 자문 모델: Opus 4.7 │ ⏱ 56m │ 비용 $1.23 │ 출력: 42.1 tok/s
컨텍스트 ████░░░░░░ 45% │ 사용량 ███░░░░░░░ 31% (리셋까지 1h 7m) | 주간 █████████░ 85% (리셋까지 2d 7h) │ 캐시 ⏱ 만료 22:12 · 히트 98%
RAM █████░░░░░ 23 GB / 48 GB (48%)
◐ Edit: .../file.ts | ✓ Bash ×12 | ✓ Read ×3
✓ 스킬 (2): pinglet, code-review
◐ Explore [haiku-4.5]: 호출부 찾기 (12s)
▸ 버그 수정 (2/5)
~statusline.ts(+39 -11)  ~cli.ts(+15 -5)  +hud.ts(+120)  ?3
토큰 13.7M (입력: 2k, 출력: 64k, 캐시: 13.7M)
압축: 1
```

캐시 줄의 히트율은 마지막 요청에서 캐시로 읽은 토큰의 비율(cache_read / 전체 입력)이라, 캐시가 만료돼 새로 쓴 턴에서 뚝 떨어집니다. prompt cache는 카운트다운이 아니라 만료 시각으로 보여줍니다. statusline은 Claude가 활동할 때만 다시 그려져서
턴 사이에는 남은 시간이 멈춘 채 보이기 때문입니다. RAM은 Claude 프로세스가 아니라 기기 전체 수치입니다.
터미널 폭을 넘는 줄은 구분자(`│`, `|`)에서 다음 줄로 감깁니다.
컨텍스트·사용량·캐시는 기본적으로 한 줄로 묶이며(`display.mergeGroups`), 폭이 모자라면 자동으로 나뉩니다.

무엇을, 어떤 순서로, 몇 줄에 보여줄지는 `pinglet hud`로 바꿉니다 (Claude Code 안에서는 `/pinglet-hud`):

```bash
pinglet hud                            # 현재 설정 + 미리보기
pinglet hud --preset minimal           # full(전부) / essential(모델·프로젝트·컨텍스트·사용량·캐시·활동) / minimal(모델+컨텍스트)
pinglet hud --layout compact           # 한 줄로 (expanded는 요소마다 한 줄)
pinglet hud --hide usage,todos         # --show 로 다시 켜기 (speed, effort, session-tokens, compactions, git-files 등)
pinglet hud --order context,project    # 줄 순서 (뺀 요소는 숨김)
pinglet hud --first-line project,model # 첫 줄 안의 세그먼트 순서
pinglet hud --off                      # HUD만 끄기 ("함께 코딩 중" 줄은 유지)
```

색상·임계값·mergeGroups 같은 고급 키는 `~/.pinglet/config.json`의 `"hud"` 섹션을 직접 편집합니다 (키 이름은 claude-hud와 같습니다).

## 자동 업데이트

새 버전이 나오면 백그라운드에서 하루 1회 확인해 자동으로 업데이트합니다
(npm 전역 설치일 때만 — pnpm/yarn 설치는 건드리지 않습니다).
끄려면 `~/.pinglet/config.json`에 `"autoUpdate": false`를 추가하세요.

## 명령어

| 명령 | 설명 |
|---|---|
| `pinglet install` | Claude Code 연결 (Codex는 `--codex`로 opt-in) |
| `pinglet login [--github \| --google]` | GitHub 또는 Google 계정 연결 (메시지 작성에 필요). 플래그가 없으면 브라우저에서 선택 |
| `pinglet logout` | 로그인 해제 (설치·캐시는 유지) |
| `pinglet post "메시지"` | Ping 보내기 |
| `pinglet ping` | 지금 표시될 메시지 미리보기 |
| `pinglet hud [옵션]` | statusline HUD 설정 (프리셋·레이아웃·표시 요소·순서) |
| `pinglet doctor` | 설치·연결 상태 진단 |
| `pinglet uninstall` | 기존 설정 복원, 서버 설치 폐기 및 로그아웃 |

## 안심하고 쓰세요

- **토큰 사용량 0** — 메시지는 Claude Code의 UI 영역(statusline/spinner)에만
  표시되고 모델 컨텍스트에는 전혀 들어가지 않습니다. API 비용과 응답 품질에
  영향이 없습니다.
- **코드를 보내지 않습니다** — 서버로 가는 것은 설치 ID, OS 종류, 클라이언트 버전,
  메시지 노출 이벤트뿐입니다. HUD는 Claude Code가 statusline에 넘기는 세션 지표와
  세션 transcript의 도구 호출 이름·대상·todo 제목만 **이 기기 안에서** 읽어 그리며,
  prompt·응답 본문은 저장하지 않고 어떤 것도 서버로 보내지 않습니다.
  HUD의 활동 줄이 필요 없으면 `pinglet hud --hide tools,agents,todos`로 끄면 transcript를 읽지 않습니다.
- **터미널이 느려지지 않습니다** — 표시는 로컬 캐시만 읽어서 그리며, 네트워크는
  백그라운드에서만 사용합니다. 오프라인에서도 동작합니다.
- **모든 메시지는 검수를 거칩니다** — URL·개인정보·제어문자·부적절한 표현은
  자동으로 걸러지며, 문제가 되는 메시지는 발견 시 바로 내려주세요
  (아래 문의·피드백 링크).

## 제거

```bash
pinglet uninstall            # 연결 해제 + 기존 설정 복원 (npm 제거보다 먼저!)
npm uninstall -g pinglet-cli
```

로컬 데이터(`~/.pinglet`)까지 지우려면 `pinglet uninstall --purge`.

`uninstall`은 서버의 설치 토큰과 현재 로그인 세션도 폐기합니다. `logout`은
현재 세션을 폐기하고 이 기기의 설치–계정 연결을 해제하되, 익명 읽기와 연동은 유지합니다.
서버 연결이나 설정 복원에 실패하면 완료로 처리하지 않으며 재시도에 필요한 데이터를 보존합니다.
`--purge`는 모든 해제가 성공한 뒤에만 실행됩니다. npm 프로그램 자체는 삭제하지 않습니다.

피드는 마지막 갱신 후 최대 10분만 사용하며, 메시지 만료 시각이 지나면 더 이상 표시하지 않습니다.

## 약관 및 개인정보처리방침

로그인하여 메시지를 작성하면 아래 문서에 동의한 것으로 간주됩니다.

- [이용약관](https://pinglet.halluci.co.kr/terms) · [개인정보처리방침](https://pinglet.halluci.co.kr/privacy)

문의·피드백: halluci-data@naver.com · [GitHub Issues](https://github.com/mabyko/pinglet-client/issues)
