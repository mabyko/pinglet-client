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
> /pinglet-login                      # once — GitHub or Google login in the browser
> /pinglet may your build stay green today
> /pinglet-logout                     # sign out on this machine
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

## HUD — session metrics in the statusline

Below the "coding along" line Pinglet renders a HUD that works the same way as
[claude-hud](https://github.com/jarrodwatts/claude-hud): model and effort level,
project and git branch (line diff, unpushed commits), the `/advisor` model, session
duration, cost and output speed, a context-usage bar, 5-hour / 7-day / per-model
weekly usage limits, the prompt-cache expiry time, machine RAM usage, the tools,
skills, subagents and todo progress of the current session, changed files, session
token totals and compaction count.

```
🟢 coding along with 41 terminals right now
[Opus 5 ◑ high] │ my-project git:(main* ↑2 [+337 -29]) │ Advisor: Opus 4.7 │ ⏱ 56m │ Cost $1.23 │ out: 42.1 tok/s
Context ████░░░░░░ 45% │ Usage ███░░░░░░░ 31% (resets in 1h 7m) | Weekly █████████░ 85% (resets in 2d 7h) │ Cache ⏱ until 10:12 PM · hit 98%
Approx RAM █████░░░░░ 23 GB / 48 GB (48%)
◐ Edit: .../file.ts | ✓ Bash ×12 | ✓ Read ×3
✓ Skills (2): pinglet, code-review
◐ Explore [haiku-4.5]: Find callers (12s)
▸ Fix the bug (2/5)
~statusline.ts(+39 -11)  ~cli.ts(+15 -5)  +hud.ts(+120)  ?3
Tokens 13.7M (in: 2k, out: 64k, cache: 13.7M)
Compactions: 1
```

The hit rate on the Cache line is the share of the last request's input that was served from cache (cache_read / total input), so it drops sharply on the turn after the cache expires. The prompt cache shows an expiry time rather than a countdown: the statusline only
repaints while Claude is active, so a countdown would freeze between turns. RAM is
the whole machine, not the Claude process. Lines wider than the terminal wrap at
their separators (`│`, `|`). Context, usage and the cache line share one row by default
(`display.mergeGroups`) and split apart when the terminal is too narrow.

Choose what to show, in which order and on how many lines with `pinglet hud`
(`/pinglet-hud` inside Claude Code):

```bash
pinglet hud                            # current settings + preview
pinglet hud --preset minimal           # full (everything) / essential (model, project, context, usage, cache, activity) / minimal (model + context)
pinglet hud --layout compact           # everything on one line (expanded = one line per element)
pinglet hud --hide usage,todos         # --show to turn them back on (also speed, effort, session-tokens, compactions, git-files, …)
pinglet hud --order context,project    # line order (omitted elements are hidden)
pinglet hud --first-line project,model # segment order inside the first line
pinglet hud --off                      # HUD only; the "coding along" line stays
```

Advanced keys (colors, thresholds, mergeGroups) live in the `"hud"` section of
`~/.pinglet/config.json` and use the same names as claude-hud.

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
| `pinglet hud [options]` | Configure the statusline HUD (preset, layout, elements, order) |
| `pinglet doctor` | Diagnose installation and connection status |
| `pinglet uninstall` | Restore settings, revoke installations and sign out |

## Safe to use

- **Zero token usage** — messages are shown only in Claude Code's UI area
  (statusline/spinner) and never enter the model context. No impact on API cost
  or response quality.
- **Never sends your code** — the only data sent to the server is an install ID,
  OS type, client version, and message-impression events. The HUD reads the
  session metrics Claude Code hands to the statusline plus tool names/targets and
  todo titles from the session transcript, **on this machine only**; prompt and
  response bodies are never stored and nothing from them leaves your machine.
  If you don't want the activity lines, `pinglet hud --hide tools,agents,todos`
  stops the transcript from being read at all.
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

`uninstall` also revokes this device's installation tokens and current login session.
`logout` revokes the current session and unlinks this device from the account, keeping
the integration and anonymous reading. If server cleanup or settings restoration fails,
the command reports failure and preserves the data needed to retry. `--purge` runs only
after successful cleanup. Neither command removes npm itself.

Cached feeds are used for at most 10 minutes and expired messages are no longer displayed.

## Terms & Privacy

By logging in and posting messages you agree to the following:

- [Terms of Service](https://pinglet.halluci.co.kr/terms) · [Privacy Policy](https://pinglet.halluci.co.kr/privacy)

Contact & feedback: halluci-data@naver.com · [GitHub Issues](https://github.com/mabyko/pinglet-client/issues)
