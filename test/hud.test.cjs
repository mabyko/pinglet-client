const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pinglet-hud-test-'));
os.homedir = () => fixture;
process.env.TZ = 'UTC';
process.env.LC_ALL = 'en_US.UTF-8';
process.env.LC_MESSAGES = 'en_US.UTF-8';
process.env.LANG = 'en_US.UTF-8';
process.env.COLUMNS = '160';
const config = require('../dist/config');
const runtime = require('../dist/runtime');
const { runStatusline, writeStatusline } = require('../dist/commands/statusline');
const { parseHudArgs, applyHudArgs, runHud, normalizeHudArgs } = require('../dist/commands/hud');
const { normalizeHudConfig, DEFAULT_HUD_CONFIG, applyPreset } = require('../dist/hud/config');
const { renderHudLines, loadHudConfig } = require('../dist/hud');
const { parseTranscript } = require('../dist/hud/transcript');
const { stripAnsi, wrapLineToWidth, truncateToWidth, visualWidth } = require('../dist/hud/width');
const { renderHud } = require('../dist/hud/render');
const { toMemoryInfo, parseVmStat, parseLinuxMeminfo, formatBytes } = require('../dist/hud/memory');
const { getGitStatus, parseFileStats, parseNumstat } = require('../dist/hud/git');
const { getOutputSpeed } = require('../dist/hud/speed');
const { parseScopedWindows, resolveEffortLevel } = require('../dist/hud/stdin');
const settingsPath = path.join(fixture, '.claude/settings.json');
const originalMaintenance = runtime.runMaintenance;
const ESC = String.fromCharCode(27);

const now = Date.parse('2026-09-08T12:00:00Z');
const transcriptPath = path.join(fixture, 'session.jsonl');
const line = (obj) => JSON.stringify(obj);
function writeTranscript(entries) {
  fs.writeFileSync(transcriptPath, entries.map(line).join('\n') + '\n');
}
const transcriptEntries = [
  { type: 'user', timestamp: '2026-09-08T11:30:00Z', slug: 'fix-auth-bug', message: { content: 'hello' } },
  { type: 'assistant', timestamp: '2026-09-08T11:31:00Z', message: { id: 'm1', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 }, content: [
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/very/long/path/to/file.ts' } },
    { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } },
    { type: 'tool_use', id: 'todo', name: 'TodoWrite', input: { todos: [
      { content: 'Write tests', status: 'completed' },
      { content: `Fix ${ESC}[31mbug${ESC}[0m`, status: 'in_progress' },
      { content: 'Ship', status: 'pending' },
    ] } },
  ] } },
  // Claude Code writes the same API response again: counted once by message.id.
  { type: 'assistant', timestamp: '2026-09-08T11:31:01Z', message: { id: 'm1', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 }, content: [{ type: 'text', text: 'ok' }] } },
  { type: 'user', timestamp: '2026-09-08T11:32:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
  // Completed agents stay on the HUD for 60s, so this one finishes 30s before "now".
  { type: 'assistant', timestamp: '2026-09-08T11:59:00Z', message: { content: [
    { type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find callers', model: 'haiku' } },
  ] } },
  { type: 'user', timestamp: '2026-09-08T11:59:30Z', message: { content: [{ type: 'tool_result', tool_use_id: 'a1' }] },
    toolUseResult: { resolvedModel: 'claude-haiku-4-5-20251001' } },
];
const payload = {
  session_id: 'session',
  transcript_path: transcriptPath,
  cwd: path.join(fixture, 'project'),
  model: { id: 'claude-opus-5', display_name: 'Opus 5 (1M context)' },
  context_window: { context_window_size: 200000, used_percentage: 88, current_usage: { input_tokens: 150000, output_tokens: 1000, cache_read_input_tokens: 26000 } },
  cost: { total_cost_usd: 1.5, total_api_duration_ms: 1000 },
  rate_limits: { five_hour: { used_percentage: 25, resets_at: Math.floor(now / 1000) + 5400 }, seven_day: { used_percentage: 90, resets_at: Math.floor(now / 1000) + 2 * 86400 } },
};
/** Defaults are the "full" preset; the baseline tests keep the environment-dependent parts off. */
const quiet = { showMemoryUsage: false, showSpeed: false, showEffortLevel: false, showSessionTokens: false, showCompactions: false };

beforeEach(() => {
  fs.rmSync(config.PINGLET_DIR, { recursive: true, force: true });
  fs.rmSync(payload.cwd, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.mkdirSync(payload.cwd, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { command: 'pinglet statusline' } }));
  config.saveConfig({ apiBaseUrl: 'https://fixture.invalid', createdAt: new Date().toISOString(),
    installations: {}, adapters: { claude: { installedAt: new Date().toISOString(), settingsPath } }, autoUpdate: false });
  writeTranscript(transcriptEntries);
  runtime.runMaintenance = () => {};
});
after(() => {
  runtime.runMaintenance = originalMaintenance;
  fs.rmSync(fixture, { recursive: true, force: true });
});

async function tick(input, clock = now) {
  const read = fs.readFileSync;
  const realNow = Date.now;
  fs.readFileSync = (file, ...args) => file === 0 ? JSON.stringify(input) : read(file, ...args);
  Date.now = () => clock;
  let output = '';
  try {
    const job = runStatusline();
    fs.readFileSync = read;
    if (job) await writeStatusline(job, clock, (text) => { output += text; });
  } finally { fs.readFileSync = read; Date.now = realNow; }
  return output.split('\n').map(stripAnsi);
}
const render = async (hud, input = payload, clock = now) => (await renderHudLines(loadHudConfig({ hud }), input, clock)).map(stripAnsi);

test('normalizeHudConfig falls back to defaults and drops unknown values', () => {
  assert.deepEqual(normalizeHudConfig(undefined), DEFAULT_HUD_CONFIG);
  const hud = normalizeHudConfig({ lineLayout: 'weird', elementOrder: ['todos', 'nope', 'todos', 'project'],
    display: { showTools: 'yes', contextWarningThreshold: 95, contextCriticalThreshold: 80, mergeGroups: [['context'], ['usage', 'context']], effortFormat: 'bogus' },
    gitStatus: { branchOverflow: 'wrap', pushWarningThreshold: -1 },
    colors: { model: '#ff0000', git: 300, barFilled: '' } });
  assert.equal(hud.lineLayout, 'expanded');
  assert.deepEqual(hud.elementOrder, ['todos', 'project']);
  assert.equal(hud.display.showTools, true);
  assert.equal(hud.display.contextWarningThreshold, 80, 'warning never exceeds critical');
  assert.deepEqual(hud.display.mergeGroups, [['usage', 'context']]);
  assert.equal(hud.display.effortFormat, 'full');
  assert.equal(hud.gitStatus.branchOverflow, 'wrap');
  assert.equal(hud.gitStatus.pushWarningThreshold, 0);
  assert.equal(hud.colors.model, '#ff0000');
  assert.equal(hud.colors.git, 'magenta');
  assert.equal(hud.colors.barFilled, '█');
  const minimal = applyPreset(DEFAULT_HUD_CONFIG, 'minimal');
  assert.equal(minimal.display.showModel, true);
  assert.equal(minimal.display.showContextBar, true);
  assert.equal(minimal.display.showUsage, false);
  assert.equal(minimal.gitStatus.enabled, false);
  assert.equal(minimal.display.showTokenBreakdown, true, 'presets leave non-preset keys alone');
});

test('transcript parser extracts tools, agents, todos, tokens and strips control characters', async () => {
  const data = await parseTranscript(transcriptPath);
  assert.deepEqual(data.tools.map(t => [t.name, t.status]), [['Read', 'completed'], ['Bash', 'running']]);
  assert.equal(data.tools[0].target, '/repo/src/very/long/path/to/file.ts');
  assert.equal(data.agents.length, 1);
  assert.equal(data.agents[0].status, 'completed');
  assert.equal(data.agents[0].model, 'claude-haiku-4-5-20251001', 'resolvedModel wins over the alias');
  assert.deepEqual(data.todos.map(t => t.content), ['Write tests', 'Fix bug', 'Ship'], 'ANSI sequences stripped');
  assert.equal(data.sessionName, 'fix-auth-bug');
  assert.equal(data.sessionStart, Date.parse('2026-09-08T11:30:00Z'));
  assert.deepEqual(data.sessionTokens, { inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 5000 }, 'duplicate record counted once');
  assert.equal(data.compactionCount, 0);
  // Cache is reused while the file is unchanged, and refreshed as soon as it changes.
  fs.appendFileSync(transcriptPath, line({ type: 'assistant', timestamp: '2026-09-08T11:33:00Z', message: { content: [{ type: 'tool_use', id: 't3', name: 'Grep', input: { pattern: 'x' } }] } }) + '\n');
  assert.equal((await parseTranscript(transcriptPath)).tools.length, 3);
  assert.deepEqual(await parseTranscript(path.join(fixture, 'missing.jsonl')), { tools: [], agents: [], todos: [], skills: [] });
});

test('transcript parser tracks skills, advisor, prompt cache anchor, compactions and ultracode', async () => {
  const base = await parseTranscript(transcriptPath);
  // No requestId: each assistant record anchors to the record before it; the last tool_result
  // (11:59:30) opened a request whose response is not written yet, so it is the live anchor.
  assert.equal(base.promptCacheAnchorAt, Date.parse('2026-09-08T11:59:30Z'));
  assert.equal(base.promptCacheTtlSeconds, undefined, 'no cache write seen');
  assert.deepEqual(base.skills, []);
  assert.equal(base.advisorModel, undefined);
  assert.equal(base.ultracodeActive, undefined);

  writeTranscript([
    ...transcriptEntries,
    { type: 'assistant', timestamp: '2026-09-08T11:59:40Z', requestId: 'r1', advisorModel: 'claude-opus-4-7',
      message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 } }, content: [
        { type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'pinglet' } },
        { type: 'tool_use', id: 's2', name: 'Skill', input: { skill: `code-review${ESC}[0m` } },
        { type: 'tool_use', id: 's3', name: 'Skill', input: { skill: 'pinglet' } },
      ] } },
    // Same request, second record: shares the anchor instead of moving it.
    { type: 'assistant', timestamp: '2026-09-08T11:59:45Z', requestId: 'r1', message: { content: [{ type: 'text', text: 'done' }] } },
    // Subagent traffic never touches the main session's cache clock.
    { type: 'user', timestamp: '2026-09-08T11:59:50Z', isSidechain: true, message: { content: 'sub prompt' } },
    { type: 'assistant', timestamp: '2026-09-08T11:59:55Z', isSidechain: true, requestId: 'sub', message: { content: [{ type: 'text', text: 'x' }] } },
    // A local slash-command echo is not a request.
    { type: 'user', timestamp: '2026-09-08T11:59:58Z', message: { content: '<local-command-stdout>ok' } },
    { type: 'system', subtype: 'compact_boundary', timestamp: '2026-09-08T11:59:59Z', compactMetadata: { trigger: 'auto' } },
    { type: 'attachment', timestamp: '2026-09-08T11:59:59Z', attachment: { type: 'ultra_effort_enter' } },
  ]);
  const data = await parseTranscript(transcriptPath);
  assert.deepEqual(data.skills, ['pinglet', 'code-review']);
  assert.equal(data.advisorModel, 'claude-opus-4-7');
  assert.equal(data.promptCacheTtlSeconds, 3600);
  assert.equal(data.promptCacheAnchorAt, Date.parse('2026-09-08T11:59:30Z'), 'anchored to the request that produced r1');
  assert.equal(data.compactionCount, 1);
  assert.equal(data.ultracodeActive, true);
  fs.appendFileSync(transcriptPath, line({ type: 'user', timestamp: '2026-09-08T12:00:10Z', message: { content: '<local-command-stdout>Set effort level to high' } }) + '\n');
  assert.equal((await parseTranscript(transcriptPath)).ultracodeActive, false, '/effort output wins in file order');
});

test('expanded layout renders project, context/usage, cache, tools, agents and todos lines', async () => {
  const lines = await render({ display: quiet, gitStatus: { enabled: false } });
  assert.equal(lines.length, 6, lines.join('\n'));
  assert.equal(lines[0], '[Opus 5 (1M context)] │ project │ fix-auth-bug │ ⏱ 30m │ Cost $1.50');
  assert.equal(lines[1], 'Context █████████░ 88% (in: 150k, cache: 26k) │ Usage ███░░░░░░░ 25% (resets in 1h 30m) | Weekly █████████░ 90% (resets in 2d)');
  assert.equal(lines[2], 'Cache ⏱ until 12:04 PM · hit 83%', 'default 5-minute TTL from the 11:59:30 anchor');
  assert.equal(lines[3], '◐ Bash: npm test | ✓ Read ×1');
  assert.equal(lines[4], '✓ Explore [haiku-4.5]: Find callers (30s)');
  assert.equal(lines[5], '▸ Fix bug (1/3)');
});

test('session tokens, compactions and effort level render like claude-hud', async () => {
  fs.appendFileSync(transcriptPath, line({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-09-08T11:59:59Z' }) + '\n');
  const display = { ...quiet, showSessionTokens: true, showCompactions: true, showEffortLevel: true };
  const withEffort = { ...payload, effort: { level: 'high' } };
  const lines = await render({ elementOrder: ['project'], display, gitStatus: { enabled: false } }, withEffort);
  assert.deepEqual(lines, [
    '[Opus 5 (1M context) ◑ high] │ project │ fix-auth-bug │ ⏱ 30m │ Cost $1.50',
    'Tokens 6k (in: 1k, out: 200, cache: 5k)',
    'Compactions: 1',
  ]);
  const symbol = await render({ elementOrder: ['project'], display: { ...display, effortFormat: 'symbol', showProject: false, showSessionName: false, showDuration: false, showCost: false }, gitStatus: { enabled: false } }, { ...withEffort, effort: 'max' });
  assert.equal(symbol[0], '[Opus 5 (1M context) ●]');
  assert.deepEqual(resolveEffortLevel({ level: 'xhigh' }, true), { level: 'ultracode(xhigh)', symbol: '◕' });
  assert.equal(resolveEffortLevel(null), null);
  const compact = await render({ lineLayout: 'compact', display: { ...display, showUsage: false, showTokenBreakdown: false, showTools: false, showAgents: false, showTodos: false }, gitStatus: { enabled: false } }, withEffort);
  assert.equal(compact[0], '[Opus 5 (1M context) ◑ high] █████████░ 88% | project | tok: 6k (in: 1k, out: 200, cache: 5k) | Compactions: 1 | fix-auth-bug | ⏱ 30m | Cost $1.50');
});

test('model-scoped weekly windows render next to the 5h/7d windows', async () => {
  const scoped = { ...payload, rate_limits: { ...payload.rate_limits, model_scoped: [
    { display_name: 'Fable', utilization: 38, resets_at: new Date(now + 3 * 86400000 + 7200000).toISOString() },
    { display_name: `bad${ESC}[0m`, utilization: 'nope' },
    { display_name: '', utilization: 10 },
  ] } };
  assert.deepEqual(parseScopedWindows(scoped.rate_limits.model_scoped).map(w => [w.label, w.percent]), [['Fable', 38]]);
  const lines = await render({ elementOrder: ['usage'], display: quiet }, scoped);
  assert.equal(lines[0], 'Usage ███░░░░░░░ 25% (resets in 1h 30m) | Weekly █████████░ 90% (resets in 2d) | Fable ████░░░░░░ 38% (resets in 3d 2h)');
  const hidden = await render({ elementOrder: ['usage'], display: { ...quiet, showModelScopedUsage: false } }, scoped);
  assert.ok(!hidden[0].includes('Fable'));
  const onlyScoped = await render({ elementOrder: ['usage'], display: quiet }, { ...scoped, rate_limits: { model_scoped: scoped.rate_limits.model_scoped } });
  assert.equal(onlyScoped[0], 'Usage Fable ████░░░░░░ 38% (resets in 3d 2h)');
});

test('prompt cache line shows expiry, warns near the end, reports expiry, and the last-request hit rate', async () => {
  // Fixture: the last main-chain response read 5000 cached tokens out of 6000 input tokens → 83%.
  const hud = { elementOrder: ['promptCache'], display: quiet };
  assert.equal((await render(hud))[0], 'Cache ⏱ until 12:04 PM · hit 83%');
  assert.equal((await render(hud, payload, Date.parse('2026-09-08T12:04:00Z')))[0], 'Cache ⏱ until 12:04 PM · hit 83%');
  assert.equal((await render(hud, payload, Date.parse('2026-09-08T12:05:00Z')))[0], 'Cache ⏱ expired · hit 83%');
  assert.equal((await render({ ...hud, display: { ...quiet, promptCacheTtlSeconds: 3600 } }))[0], 'Cache ⏱ until 12:59 PM · hit 83%', 'configured TTL is the fallback');
  assert.equal((await render({ ...hud, display: { ...quiet, showCacheHitRate: false } }))[0], 'Cache ⏱ until 12:04 PM');
  assert.deepEqual(await render(hud, { ...payload, transcript_path: path.join(fixture, 'missing.jsonl') }), [], 'no anchor, no line');
  // A fresh cache write after expiry drops the rate; subagent responses never replace the main-chain value.
  fs.appendFileSync(transcriptPath, [
    line({ type: 'assistant', timestamp: '2026-09-08T11:59:50Z', message: { id: 'm2', usage: { input_tokens: 100, cache_creation_input_tokens: 9000, cache_read_input_tokens: 900 }, content: [{ type: 'text', text: 'x' }] } }),
    line({ type: 'assistant', timestamp: '2026-09-08T11:59:55Z', isSidechain: true, message: { id: 'sub', usage: { input_tokens: 1, cache_read_input_tokens: 999 }, content: [{ type: 'text', text: 'y' }] } }),
  ].join('\n') + '\n');
  assert.equal((await render(hud))[0], 'Cache ⏱ until 12:04 PM · hit 9%');
});

test('skills line and advisor segment come from the transcript; tools line hides Skill calls', async () => {
  writeTranscript([
    ...transcriptEntries,
    { type: 'assistant', timestamp: '2026-09-08T11:59:40Z', advisorModel: 'claude-opus-4-7', message: { content: [
      { type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'pinglet' } },
      { type: 'tool_use', id: 's2', name: 'Skill', input: { skill: 'code-review' } },
      { type: 'tool_use', id: 's3', name: 'Skill', input: { skill: 'dataviz' } },
      { type: 'tool_use', id: 's4', name: 'Skill', input: { skill: 'design' } },
      { type: 'tool_use', id: 's5', name: 'Skill', input: { skill: 'eli5' } },
    ] } },
  ]);
  const display = { ...quiet, showSessionName: false, showDuration: false, showCost: false };
  const lines = await render({ elementOrder: ['project', 'tools', 'skills'], display, gitStatus: { enabled: false } });
  assert.deepEqual(lines, [
    '[Opus 5 (1M context)] │ project │ Advisor: Opus 4.7',
    '◐ Bash: npm test | ✓ Read ×1',
    '✓ Skills (5): pinglet, code-review, dataviz, design, +1 more',
  ]);
  const noSkills = await render({ elementOrder: ['tools'], display: { ...display, showSkills: false, showAdvisor: false } });
  assert.equal(noSkills[0], '◐ Skill: design | ◐ Skill: eli5 | ✓ Read ×1', 'Skill calls fall back to the tools line (last two running)');
  const override = await render({ elementOrder: ['project'], projectLineOrder: ['advisor'], display: { ...display, advisorOverride: `Mentor${ESC}[31m` }, gitStatus: { enabled: false } });
  assert.equal(override[0], 'Advisor: Mentor │ [Opus 5 (1M context)] │ project');
});

test('compact layout puts the session on one line and honours order/toggles', async () => {
  const display = { ...quiet, showTools: false, showAgents: false, modelFormat: 'compact', usageCompact: true, showTokenBreakdown: false, showSessionName: false, showDuration: false, showCost: false };
  assert.deepEqual(await render({ lineLayout: 'compact', display, gitStatus: { enabled: false } }), [
    '[Opus 5] █████████░ 88% | project | Usage 5h: 25% (1h 30m) | Weekly: 90% (2d)',
    '▸ Fix bug (1/3)',
  ]);
  assert.deepEqual(await render({ elementOrder: ['todos', 'context'], display: { ...display, mergeGroups: [] }, gitStatus: { enabled: false } }),
    ['▸ Fix bug (1/3)', 'Context █████████░ 88%']);
  assert.deepEqual(await render({ elementOrder: ['project'], projectLineOrder: ['project'], display, gitStatus: { enabled: false } }),
    ['project │ [Opus 5]']);
});

test('lines that overflow the terminal wrap at separators like claude-hud', async () => {
  assert.deepEqual(wrapLineToWidth('[Opus 5 (1M context)] | project | Usage 5h: 25%', 32), ['[Opus 5 (1M context)] | project', 'Usage 5h: 25%']);
  assert.deepEqual(wrapLineToWidth('[Opus 5 (1M context)] | project | Usage 5h: 25%', 30), ['[Opus 5 (1M context)]', 'project | Usage 5h: 25%']);
  assert.deepEqual(wrapLineToWidth('[Opus | 5] | project', 12), ['[Opus | 5]', 'project'], 'model badge is never split');
  assert.equal(truncateToWidth('컨텍스트 ████ 45%', 8), `컨텍...${ESC}[0m`);
  assert.equal(visualWidth(`${ESC}]8;;https://x.y${ESC}\\link${ESC}]8;;${ESC}\\`), 4, 'OSC 8 hyperlinks take no cells');
  process.env.COLUMNS = '60';
  try {
    const lines = await render({ display: quiet, gitStatus: { enabled: false } });
    assert.ok(lines.every(l => visualWidth(l) <= 60), lines.join('\n'));
    assert.deepEqual(lines.slice(0, 3), ['[Opus 5 (1M context)] │ project │ fix-auth-bug │ ⏱ 30m', 'Cost $1.50', 'Context █████░ 88% (in: 150k, cache: 26k)']);
  } finally { process.env.COLUMNS = '160'; }
});

test('HUD hides itself when disabled', async () => {
  assert.deepEqual(await render({ enabled: false }), []);
  assert.deepEqual(await render({}, {}), [], 'no payload means no HUD lines');
});

test('git status, badge, ahead/behind and the changed-files line follow claude-hud', async () => {
  const repo = payload.cwd;
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x' } });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'one\ntwo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', 'git@github.com:mabyko/pinglet-client.git');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'one\nthree\nfour\n');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x\n');
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'y\n');
  git('add', 'staged.txt');

  const status = await getGitStatus(repo);
  assert.equal(status.branch, 'main');
  assert.equal(status.isDirty, true);
  assert.equal(status.branchUrl, 'https://github.com/mabyko/pinglet-client/tree/main');
  assert.deepEqual({ ...status.fileStats, trackedFiles: status.fileStats.trackedFiles.map(f => [f.basename, f.type, f.lineDiff]) },
    { modified: 1, added: 1, deleted: 0, untracked: 1, trackedFiles: [['keep.txt', 'modified', { added: 2, deleted: 1 }], ['staged.txt', 'added', { added: 1, deleted: 0 }]] });
  assert.deepEqual(status.lineDiff, { added: 3, deleted: 1 });
  assert.equal(await getGitStatus(path.join(fixture, 'not-a-repo')), null);

  const display = { ...quiet, showSessionName: false, showDuration: false, showCost: false };
  const expanded = await render({ elementOrder: ['project'], display });
  assert.equal(expanded[0], '[Opus 5 (1M context)] │ project git:(main* [+3 -1])');
  assert.match(expanded[1], /^(~keep\.txt\(\+2 -1\)  \+staged\.txt\(\+1\)|\+staged\.txt\(\+1\)  ~keep\.txt\(\+2 -1\))  \?1$/);
  const compact = await render({ lineLayout: 'compact', display: { ...display, showUsage: false, showTokenBreakdown: false, showTools: false, showAgents: false, showTodos: false } });
  assert.equal(compact[0], '[Opus 5 (1M context)] █████████░ 88% | project git:(main* !1 +1 ?1)');
  const plain = await render({ elementOrder: ['project'], display, gitStatus: { showFileStats: false, showDirty: false } });
  assert.deepEqual(plain, ['[Opus 5 (1M context)] │ project git:(main)']);
  const wrap = await render({ elementOrder: ['project'], display, gitStatus: { showFileStats: false, branchOverflow: 'wrap' } });
  assert.equal(wrap[0], '[Opus 5 (1M context)] │ project │ git:(main*)');

  assert.deepEqual(parseFileStats(' M a.ts\n?? b\nA  c.ts\n D d.ts\nR  old.ts -> new.ts\n').trackedFiles.map(f => f.fullPath), ['a.ts', 'c.ts', 'd.ts', 'new.ts']);
  const numstat = parseNumstat('3\t1\tsrc/{old.ts => new.ts}\n-\t-\tbin.png\n', new Set(['src/new.ts']));
  assert.deepEqual([numstat.total, [...numstat.perFile.keys()]], [{ added: 3, deleted: 1 }, ['src/new.ts']]);
});

test('output speed is the output_tokens delta over a bounded window', () => {
  const at = (tokens, clock) => getOutputSpeed({ ...payload, context_window: { current_usage: { output_tokens: tokens } } }, clock);
  assert.equal(at(100, now), null, 'first sample only primes the cache');
  assert.equal(at(150, now + 200), null, 'windows under 500ms are ignored');
  assert.equal(at(200, now + 1000), 100);
  assert.equal(at(250, now + 10000), null, 'idle gap resets the window');
  assert.equal(at(50, now + 10500), null, 'counter reset (new session) primes again');
  assert.equal(getOutputSpeed({ context_window: { current_usage: { output_tokens: 5 } } }, now), null, 'no transcript path, no session key');
});

test('memory line renders machine RAM in expanded layout only', async () => {
  const GB = 1024 ** 3;
  const memory = toMemoryInfo({ totalBytes: 32 * GB, freeBytes: 32 * GB - 13.4 * GB });
  assert.equal(memory.totalBytes, 32 * GB);
  assert.ok(Math.abs(memory.usedBytes - 13.4 * GB) < 1);
  assert.equal(memory.usedPercent, 42);
  const ctx = (layout) => ({ config: loadHudConfig({ hud: { lineLayout: layout, elementOrder: ['memory'], gitStatus: { enabled: false } } }),
    payload, transcript: { tools: [], agents: [], todos: [], skills: [] }, gitStatus: null, memory, speed: null, now });
  assert.deepEqual(renderHud(ctx('expanded')).map(stripAnsi), ['Approx RAM ████░░░░░░ 13 GB / 32 GB (42%)']);
  assert.deepEqual(renderHud(ctx('compact')).map(stripAnsi).filter(l => l.includes('RAM')), []);
  assert.equal(toMemoryInfo({ totalBytes: 0, freeBytes: 0 }), null);
  assert.deepEqual(parseVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 100.\nPages active: 1000.\nPages wired down: 500.\n'), { pageSize: 16384, active: 1000, wired: 500 });
  assert.deepEqual(parseLinuxMeminfo('MemTotal:       16384 kB\nMemFree:  1 kB\nMemAvailable:    8192 kB\n'), { totalBytes: 16384 * 1024, freeBytes: 8192 * 1024 });
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(48 * GB), '48 GB');
  // Real reader path: whatever the machine reports must be a sane percentage.
  const live = await render({ elementOrder: ['memory'] });
  assert.match(live[0] ?? 'Approx RAM missing', /^Approx RAM [█░]+ [\d.]+ [KMGT]?B \/ [\d.]+ [KMGT]?B \(\d{1,3}%\)$/);
});

test('statusline prints the online line first and the HUD below it', async () => {
  fs.writeFileSync(config.ONLINE_PATH, JSON.stringify({ onlineInstallations: 42, updatedAt: new Date(now).toISOString() }));
  const lines = await tick(payload);
  assert.equal(lines[0], '🟢 coding along with 41 terminals right now');
  assert.match(lines[1], /^\[Opus 5 \(1M context\)\] │ project/);
  assert.ok(lines.length >= 4, lines.join('\n'));
  const saved = config.loadConfig();
  saved.hud = { enabled: false };
  config.saveConfig(saved);
  assert.deepEqual(await tick(payload), ['🟢 coding along with 41 terminals right now']);
  // A broken transcript never breaks the tick.
  saved.hud = { enabled: true };
  config.saveConfig(saved);
  fs.writeFileSync(transcriptPath, '{not json\n');
  assert.match((await tick(payload, now + 10000))[1], /^\[Opus 5/);
});

test('pinglet hud flags update config and reject bad values', async () => {
  const parsed = parseHudArgs(['--preset', 'minimal', '--layout', 'compact', '--show', 'tools,cost,git-files', '--hide', 'model,memory,prompt-cache,advisor',
    '--order', 'context,promptCache,project', '--first-line', 'project,speed,model', '--path-levels', '2', '--separators', 'on', '--git', 'off', '--hide', 'cache-hit']);
  assert.deepEqual(parsed.errors, []);
  const hud = applyHudArgs(DEFAULT_HUD_CONFIG, parsed);
  assert.equal(hud.lineLayout, 'compact');
  assert.equal(hud.display.showTools, true);
  assert.equal(hud.display.showCost, true);
  assert.equal(hud.display.showModel, false);
  assert.equal(hud.display.showAgents, false, 'preset applied before toggles');
  assert.equal(hud.display.showMemoryUsage, false);
  assert.equal(hud.display.showPromptCache, false);
  assert.equal(hud.display.showAdvisor, false);
  assert.equal(hud.gitStatus.showFileStats, true);
  assert.equal(hud.display.showCacheHitRate, false);
  assert.deepEqual(hud.elementOrder, ['context', 'promptCache', 'project']);
  assert.deepEqual(hud.projectLineOrder, ['project', 'speed', 'model']);
  assert.equal(hud.pathLevels, 2);
  assert.equal(hud.showSeparators, true);
  assert.equal(hud.gitStatus.enabled, false);
  assert.equal(parseHudArgs(['--preset', 'nope', '--order', 'x', '--bogus']).errors.length, 3);

  // The slash command reads better without dashes, so bare forms normalize to the same flags.
  assert.deepEqual(normalizeHudArgs(['essential']), ['--preset', 'essential']);
  assert.deepEqual(normalizeHudArgs(['preset', 'essential']), ['--preset', 'essential']);
  assert.deepEqual(normalizeHudArgs(['compact']), ['--layout', 'compact']);
  assert.deepEqual(normalizeHudArgs(['hide', 'memory,speed', 'git', 'off']), ['--hide', 'memory,speed', '--git', 'off']);
  assert.deepEqual(normalizeHudArgs(['off']), ['--off'], 'a bare on/off toggles the HUD');
  assert.deepEqual(normalizeHudArgs(['--git', 'off']), ['--git', 'off'], 'a flag value is never promoted');
  assert.deepEqual(normalizeHudArgs(['--separators', 'on']), ['--separators', 'on']);
  assert.deepEqual(parseHudArgs(['essential', 'hide', 'memory']).errors, []);
  assert.equal(parseHudArgs(['essential', 'hide', 'memory']).preset, 'essential');
  assert.deepEqual(parseHudArgs(['--quiet', 'minimal']).errors, [], '--quiet is tolerated');

  const logs = [];
  const log = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    await runHud(['--layout', 'compact', '--hide', 'usage'], { quiet: true });
    assert.equal(loadHudConfig(config.loadConfig()).lineLayout, 'compact');
    assert.equal(loadHudConfig(config.loadConfig()).display.showUsage, false);
    await runHud(['--preset', 'nope']);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    await runHud(['--reset']);
    assert.deepEqual(loadHudConfig(config.loadConfig()), DEFAULT_HUD_CONFIG);
    assert.ok(logs.some(l => l.includes('Preview')));
  } finally { console.log = log; }
});
