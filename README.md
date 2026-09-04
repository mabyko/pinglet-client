# Pinglet 💌

**While the AI thinks, meet a line from another developer.**

That spot where you used to stare at Claude Code's "Befuddling…" spinner
now shows short messages (**Pings**) left by other developers.

![Pinglet demo — another developer's Ping shown in place of the Claude Code spinner](docs/pinglet-demo.gif)

```
✶ 💌 "Friday-afternoon deploys are a next-life problem." (12s · ↓ 1.2k tokens)
```

🌐 **Website**: https://pinglet.halluci.co.kr/en/

🇰🇷 [한국어](./README.ko.md) · 🇯🇵 [日本語](./README.ja.md)

## Getting started

```bash
npm install -g pinglet-cli && pinglet install
```

That's it. Just run `claude` as usual.

> npm may show an `install-scripts` warning during installation — it refers to a
> script that used to automate setup on older npm versions and can be ignored.
> You can check the connection anytime with `pinglet doctor`.

- If you already have a statusline configured, Pinglet **asks before replacing it (after backing it up)** and restores the original on uninstall.
- Codex is supported too (experimental) — a Ping arrives as a macOS notification when a turn completes.
  Since notifications can be noisy, it's excluded from the default install; opt in with `pinglet install --codex`.

## Sending a Ping

Right from a Claude Code session:

```
> /pinglet may your build stay green today
```

Or from the terminal:

```bash
pinglet login          # GitHub or Google login — opens a browser and completes automatically (once)
pinglet post "message"
```

Reading requires no login; **only posting requires a login (GitHub or Google).**

The statusline shows how many terminals are coding alongside you right now:

```
🟢 coding along with 41 terminals right now
```

The statusline picks its language from your system language (Korean/Japanese, English otherwise), falling back to your timezone (Seoul/Tokyo) when the language doesn't decide it.

## Auto-update

Pinglet checks for a new version once a day in the background and updates
itself automatically (only for npm global installs — pnpm/yarn installs are
left untouched). To opt out, add `"autoUpdate": false` to `~/.pinglet/config.json`.

## Commands

| Command | Description |
|---|---|
| `pinglet install` | Connect to Claude Code (opt in to Codex with `--codex`) |
| `pinglet login [--github \| --google]` | Link your GitHub or Google account (required for posting). Without a flag you pick in the browser |
| `pinglet logout` | Sign out on this machine (keeps the integration and cache) |
| `pinglet post "message"` | Send a Ping |
| `pinglet ping` | Preview the message that would be shown now |
| `pinglet doctor` | Diagnose installation and connection status |
| `pinglet uninstall` | Disconnect and restore your previous settings |

## Safe to use

- **Zero token usage** — messages are shown only in Claude Code's UI area
  (statusline/spinner) and never enter the model context. No impact on API cost
  or response quality.
- **Never reads your code** — no access to prompts, responses, code, or
  environment variables. The only data collected: an install ID, OS type,
  client version, and message-impression events.
- **Doesn't slow down your terminal** — rendering reads only a local cache;
  the network is used in the background only. Works offline too.
- **Every message is moderated** — URLs, personal information, control
  characters, and inappropriate content are filtered automatically. If you spot
  a problematic message, report it via the links below and we'll take it down.

## Uninstall

```bash
pinglet uninstall            # disconnect + restore previous settings (do this before removing the npm package!)
npm uninstall -g pinglet-cli
```

To also remove local data (`~/.pinglet`), run `pinglet uninstall --purge`.

## Terms & Privacy

By logging in and posting messages you agree to the following:

- [Terms of Service](https://pinglet.halluci.co.kr/terms) · [Privacy Policy](https://pinglet.halluci.co.kr/privacy)

Contact & feedback: halluci-data@naver.com · [GitHub Issues](https://github.com/mabyko/pinglet-client/issues)
