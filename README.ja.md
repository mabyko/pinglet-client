# Pinglet 💌

**AIが考えている間、他の開発者のひと言に出会おう。**

Claude Code がコードを直している間、「Befuddling…」のスピナーをただ眺めていたその場所に、
他の開発者が残した短いメッセージ（**Ping**）が代わりに表示されます。

![Pinglet デモ — Claude Code のスピナーの位置に他の開発者の Ping が表示される](docs/pinglet-demo.gif)

```
✶ 💌 "金曜午後のデプロイは来世にしましょう。" (12s · ↓ 1.2k tokens)
```

🌐 **ホームページ**: https://pinglet.halluci.co.kr/ja/

🇺🇸 [English](./README.md) · 🇰🇷 [한국어](./README.ko.md)

## はじめに

```bash
npm install -g pinglet-cli && pinglet install
```

これだけです。あとはいつも通り `claude` を実行するだけ。

> インストール中に npm が `install-scripts` の警告を表示することがあります — 古い npm で
> 初期設定を自動化していたスクリプトに関する案内で、無視して構いません。
> 接続状態は `pinglet doctor` でいつでも確認できます。

- 既存の statusline 設定がある場合は**バックアップした上で置き換えるか確認し**、アンインストール時に元に戻します。
- Codex にも対応しています（experimental）— turn 完了時に macOS 通知で Ping が届きます。
  通知が煩わしい場合があるためデフォルトでは無効になっており、必要なときだけ `pinglet install --codex` で有効にしてください。

## Ping を送る

Claude Code セッションの中からそのまま:

```
> /pinglet-login                      # 初回のみ — ブラウザで GitHub または Google ログイン
> /pinglet 今日もビルドが緑でありますように
> /pinglet-logout                     # このマシンのログアウト
```

またはターミナルから:

```bash
pinglet login          # GitHub または Google ログイン — ブラウザが開き自動で完了します（初回のみ）
pinglet post "メッセージ"
```

読むだけならログイン不要で、**投稿にのみログイン（GitHub または Google）が必要です。**

いま何個のターミナルが一緒に起動しているかが statusline に表示されます:

```
🟢 いま41個のターミナルと一緒にコーディング中
```

statusline の言語はシステム言語に応じて自動選択されます(韓国語/日本語、それ以外は英語)。言語で判定できない場合はタイムゾーン(ソウル/東京)で推定します。

## HUD — セッション情報を statusline に

「一緒にコーディング中」の行の下に、[claude-hud](https://github.com/jarrodwatts/claude-hud) と同じ方式の HUD が表示されます。
モデルと effort レベル、プロジェクト・git ブランチ（変更行数・未プッシュのコミット）、`/advisor` モデル、セッション時間・コスト・出力速度、
コンテキスト使用率バー、5時間/7日/モデル別週間の使用量上限、prompt cache の期限時刻、端末の RAM 使用率、
実行中のツール・呼び出したスキル・サブエージェント・todo の進捗、変更ファイル一覧、セッション累計トークン、圧縮回数です。

```
🟢 いま41個のターミナルと一緒にコーディング中
[Opus 5 ◑ high] │ my-project git:(main* ↑2 [+337 -29]) │ アドバイザー: Opus 4.7 │ ⏱ 56m │ コスト $1.23 │ 出力: 42.1 tok/s
コンテキスト ████░░░░░░ 45% │ 使用量 ███░░░░░░░ 31% (リセットまで 1h 7m) | 週間 █████████░ 85% (リセットまで 2d 7h) │ キャッシュ ⏱ 期限 22:12 · ヒット 98%
RAM █████░░░░░ 23 GB / 48 GB (48%)
◐ Edit: .../file.ts | ✓ Bash ×12 | ✓ Read ×3
✓ スキル (2): pinglet, code-review
◐ Explore [haiku-4.5]: 呼び出し元を探す (12s)
▸ バグ修正 (2/5)
~statusline.ts(+39 -11)  ~cli.ts(+15 -5)  +hud.ts(+120)  ?3
トークン 13.7M (入力: 2k, 出力: 64k, キャッシュ: 13.7M)
圧縮: 1
```

キャッシュ行のヒット率は直近リクエストの入力のうちキャッシュから読まれた割合（cache_read / 入力合計）で、キャッシュ期限切れ後に書き直したターンで大きく下がります。prompt cache はカウントダウンではなく期限時刻で表示します。statusline は Claude が動作中にしか再描画されず、
ターン間では残り時間が止まったまま見えるためです。RAM は Claude プロセスではなく端末全体の値です。
端末幅を超える行は区切り（`│`, `|`）で次の行に折り返します。
コンテキスト・使用量・キャッシュは既定で1行にまとめられ（`display.mergeGroups`）、幅が足りなければ自動的に分かれます。

何を・どの順で・何行に表示するかは `pinglet hud` で変更します（Claude Code 内では `/pinglet-hud`）:

```bash
pinglet hud                            # 現在の設定 + プレビュー
pinglet hud --preset minimal           # full(すべて) / essential(モデル・プロジェクト・コンテキスト・使用量・キャッシュ・アクティビティ) / minimal(モデル+コンテキスト)
pinglet hud --layout compact           # 1行にまとめる（expanded は要素ごとに1行）
pinglet hud --hide usage,todos         # --show で再表示（speed, effort, session-tokens, compactions, git-files なども）
pinglet hud --order context,project    # 行の順序（省いた要素は非表示）
pinglet hud --first-line project,model # 1行目のセグメント順
pinglet hud --off                      # HUD のみオフ（「一緒にコーディング中」の行は残る）
```

色・しきい値・mergeGroups などの上級キーは `~/.pinglet/config.json` の `"hud"` セクションを直接編集します（キー名は claude-hud と同じです）。

## 自動アップデート

新しいバージョンが出ると、バックグラウンドで1日1回チェックして自動的に
アップデートします(npm グローバルインストールのみ — pnpm/yarn は対象外)。
無効にするには `~/.pinglet/config.json` に `"autoUpdate": false` を追加してください。

## コマンド

| コマンド | 説明 |
|---|---|
| `pinglet install` | Claude Code に接続（Codex は `--codex` でオプトイン） |
| `pinglet login [--github \| --google]` | GitHub または Google アカウントを連携（投稿に必要）。フラグ省略時はブラウザで選択 |
| `pinglet logout` | ログアウト（連携設定・キャッシュは維持） |
| `pinglet post "メッセージ"` | Ping を送る |
| `pinglet ping` | いま表示されるメッセージをプレビュー |
| `pinglet hud [オプション]` | statusline HUD の設定（プリセット・レイアウト・表示要素・順序） |
| `pinglet doctor` | インストール・接続状態を診断 |
| `pinglet uninstall` | 設定復元、サーバー上のインストール失効とログアウト |

## 安心して使えます

- **トークン使用量 0** — メッセージは Claude Code の UI 領域（statusline/spinner）にのみ
  表示され、モデルのコンテキストには一切入りません。API コストや応答品質に影響はありません。
- **コードを送信しません** — サーバーに送るのはインストール ID、OS の種類、クライアントのバージョン、
  メッセージ表示イベントだけです。HUD は Claude Code が statusline に渡すセッション指標と、
  セッション transcript のツール名・対象・todo タイトルを**この端末内でのみ**読んで描画します。
  prompt・応答本文は保存せず、それらが端末の外に出ることはありません。
  活動行が不要なら `pinglet hud --hide tools,agents,todos` で transcript を一切読まなくなります。
- **ターミナルが遅くなりません** — 表示はローカルキャッシュを読むだけで、ネットワークは
  バックグラウンドでのみ使用します。オフラインでも動作します。
- **すべてのメッセージは審査を通ります** — URL・個人情報・制御文字・不適切な表現は
  自動的にフィルタリングされます。問題のあるメッセージを見つけたら、下記の連絡先から
  お知らせください。すぐに取り下げます。

## アンインストール

```bash
pinglet uninstall            # 接続解除 + 元の設定を復元（npm から削除する前に！）
npm uninstall -g pinglet-cli
```

ローカルデータ（`~/.pinglet`）まで削除するには `pinglet uninstall --purge`。

`uninstall` は端末のインストールトークンと現在のログインセッションも失効させます。
`logout` は現在のセッションと端末のアカウント連携を解除し、連携設定と匿名閲覧は維持します。
サーバー接続や設定復元に失敗した場合、再試行に必要なデータを保持し、失敗を表示します。
`--purge` はすべての解除に成功した後に実行します。npm 本体は削除しません。

フィードキャッシュは更新後最大10分まで使用し、有効期限を過ぎたメッセージは表示しません。

## 利用規約とプライバシーポリシー

ログインしてメッセージを投稿すると、以下の文書に同意したものとみなされます。

- [利用規約](https://pinglet.halluci.co.kr/terms) · [プライバシーポリシー](https://pinglet.halluci.co.kr/privacy)

お問い合わせ・フィードバック: halluci-data@naver.com · [GitHub Issues](https://github.com/mabyko/pinglet-client/issues)
