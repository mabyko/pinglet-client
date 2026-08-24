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
> /pinglet 今日もビルドが緑でありますように
```

またはターミナルから:

```bash
pinglet login          # GitHub ログイン — ブラウザが開き自動で完了します（初回のみ）
pinglet post "メッセージ"
```

読むだけならログイン不要で、**投稿にのみ GitHub ログインが必要です。**
自分の Ping がどれだけ届いたかは statusline ですぐ確認できます:

```
💌 自分の Ping "今日もビルドが緑でありますように" → 到達率 17%
```

## コマンド

| コマンド | 説明 |
|---|---|
| `pinglet install` | Claude Code に接続（Codex は `--codex` でオプトイン） |
| `pinglet login` | GitHub アカウントを連携（投稿に必要） |
| `pinglet post "メッセージ"` | Ping を送る |
| `pinglet ping` | いま表示されるメッセージをプレビュー |
| `pinglet doctor` | インストール・接続状態を診断 |
| `pinglet uninstall` | 接続解除と元の設定の復元 |

## 安心して使えます

- **トークン使用量 0** — メッセージは Claude Code の UI 領域（statusline/spinner）にのみ
  表示され、モデルのコンテキストには一切入りません。API コストや応答品質に影響はありません。
- **コードを読みません** — prompt、応答、コード、環境変数にはアクセスしません。
  収集するのはインストール ID、OS の種類、クライアントのバージョン、メッセージ表示イベントだけです。
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

## 利用規約とプライバシーポリシー

ログインしてメッセージを投稿すると、以下の文書に同意したものとみなされます。

- [利用規約](https://pinglet.halluci.co.kr/terms) · [プライバシーポリシー](https://pinglet.halluci.co.kr/privacy)

お問い合わせ・フィードバック: halluci-data@naver.com · [GitHub Issues](https://github.com/mabyko/pinglet-client/issues)
