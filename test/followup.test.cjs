const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pinglet-followup-test-'));
os.homedir = () => fixture;
const config = require('../dist/config');
const cache = require('../dist/cache');
const queue = require('../dist/queue');
const runtime = require('../dist/runtime');
const { withPingletLock, withCommandLock } = require('../dist/lock');
const { runPost } = require('../dist/commands/post');
const { runLogin } = require('../dist/commands/login');
const { runUninstall } = require('../dist/commands/uninstall');
const { runInstall } = require('../dist/commands/install');
const { runFlush } = require('../dist/commands/flush');
const { runRefresh } = require('../dist/commands/refresh');
const { runStatusline } = require('../dist/commands/statusline');
const { enqueueNotification, drainNotifications } = require('../dist/notifications');
const settingsPath = path.join(fixture, '.claude/settings.json');
const originalFetch = global.fetch;
const originalMaintenance = runtime.runMaintenance;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const message = { id: 'message', text: 'fixture message', author: 'fixture', contentType: 'USER' };
beforeEach(() => {
  fs.rmSync(config.PINGLET_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { command: 'pinglet statusline' } }));
  config.saveConfig({ apiBaseUrl: 'https://fixture.invalid', createdAt: new Date().toISOString(), userToken: 'user-token',
    installations: { CLAUDE: { installationId: 'old-install', token: 'old-token', registeredAt: new Date().toISOString() } },
    adapters: { claude: { installedAt: new Date().toISOString(), settingsPath } }, autoUpdate: false });
  cache.saveFeedMessages([message]);
  runtime.runMaintenance = () => {};
  global.fetch = async () => { throw new Error('Unexpected network'); };
});
after(() => {
  global.fetch = originalFetch;
  runtime.runMaintenance = originalMaintenance;
  fs.rmSync(fixture, { recursive: true, force: true });
});
function tick(payload = {}) {
  const read = fs.readFileSync;
  fs.readFileSync = (file, ...args) => file === 0 ? JSON.stringify(payload) : read(file, ...args);
  try { runStatusline(); } finally { fs.readFileSync = read; }
}
const queued = () => fs.readdirSync(config.PINGLET_DIR).filter(name => /^notify-.*\.json$/.test(name));
function cli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '../dist/cli.js'), ...args], {
      env: { ...process.env, PINGLET_TEST_HOME: fixture,
        NODE_OPTIONS: `--require ${JSON.stringify(path.join(__dirname, 'home.cjs'))}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timed out: ' + output)); }, 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(output)); });
    child.stdin.end(input);
  });
}

test('real CLI statusline and version work while another command owns the command lock', async () => {
  cache.saveState({ seen: {}, lastFlushAt: Date.now(), lastRefreshAt: Date.now() });
  await withCommandLock(async () => {
    await cli(['statusline'], '{}');
    assert.equal(queue.readEvents().length, 1);
    assert.equal((await cli(['--version'])).trim(), config.VERSION);
  });
});

test('real CLI notify returns while busy and detached worker consumes its durable queue afterwards', async () => {
  const cfg = config.loadConfig();
  cfg.adapters.codex = { installedAt: 'cli-generation', configPath: 'fixture' };
  config.saveConfig(cfg);
  // No display/HTTP side effects in this subprocess fixture.
  cache.saveFeedMessages([]);
  cache.saveState({ seen: {}, lastFlushAt: Date.now(), lastRefreshAt: Date.now() });
  await withPingletLock(async () => {
    await cli(['notify', '{"type":"agent-turn-complete"}']);
    assert.equal(queued().length, 1);
  });
  const deadline = Date.now() + 3000;
  while (queued().length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(queued().length, 0);
});

test('login network wait does not block a statusline transaction or overwrite hook metadata', async () => {
  let called = false;
  global.fetch = async url => {
    if (url.endsWith('/users/me')) {
      assert.equal(await withPingletLock(() => {
        const current = config.loadConfig();
        current.adapters.claude.spinnerVerbsBackup = { verbs: ['user-original'] };
        config.saveConfig(current);
        tick();
        return true;
      }, { skipIfBusy: true }), true);
      called = true;
      return reply({ id: 'user' });
    }
    return reply({ revoked: true, linked: true });
  };
  await withCommandLock(() => runLogin(['--token', 'new-token', '--quiet']));
  assert.equal(called, true);
  assert.deepEqual(config.loadConfig().adapters.claude.spinnerVerbsBackup, { verbs: ['user-original'] });
  assert.equal(queue.readEvents().length, 1);
});

test('Codex notification survives a busy local lock and drains once; stale installation is discarded', async () => {
  const cfg = config.loadConfig();
  cfg.adapters.codex = { installedAt: 'generation-one', configPath: 'fixture' };
  config.saveConfig(cfg);
  const childProcess = require('node:child_process');
  const execFile = childProcess.execFile;
  childProcess.execFile = () => ({});
  try {
    await withPingletLock(async () => {
      assert.equal(enqueueNotification([JSON.stringify({ type: 'agent-turn-complete', secret: 'must-not-store' })]), true);
      await withPingletLock(drainNotifications, { skipIfBusy: true });
      assert.equal(queued().length, 1);
      assert.equal(fs.readFileSync(path.join(config.PINGLET_DIR, queued()[0]), 'utf8').includes('must-not-store'), false);
    });
    await withCommandLock(() => withPingletLock(drainNotifications));
    await withPingletLock(drainNotifications);
    assert.equal(queued().length, 0);
    assert.equal(queue.readEvents().filter(e => e.agentType === 'CODEX').length, 1);
    enqueueNotification([]);
    cfg.adapters.codex.installedAt = 'generation-two';
    config.saveConfig(cfg);
    await withPingletLock(drainNotifications);
    assert.equal(queue.readEvents().length, 1);
    fs.rmSync(config.PINGLET_DIR, { recursive: true, force: true });
    assert.equal(enqueueNotification([]), false);
    assert.equal(fs.existsSync(config.PINGLET_DIR), false);
  } finally { childProcess.execFile = execFile; }
});

test('NETWORK then 429/401 then success reuses one post requestId', async () => {
  const ids = [];
  global.fetch = async (_, options) => {
    ids.push(JSON.parse(options.body).requestId);
    if (ids.length === 1) throw new Error('ambiguous commit');
    if (ids.length === 2) return reply({}, 429);
    if (ids.length === 3) return reply({}, 401);
    return reply({ id: 'saved', status: 'APPROVED' });
  };
  for (let i = 0; i < 4; i++) await runPost(['same post', '--quiet']);
  assert.equal(new Set(ids).size, 1);
  await runPost(['same post', '--quiet']);
  assert.notEqual(ids[4], ids[0]);
});

test('pending request identity survives same-account JWT rotation', () => {
  const { pendingPostId } = require('../dist/pending-post');
  const token = nonce => `header.${Buffer.from(JSON.stringify({ kind: 'user', sub: 'same-user', jti: nonce })).toString('base64url')}.sig`;
  const cfg = config.loadConfig();
  cfg.userToken = token('first');
  const id = pendingPostId(cfg, 'same post');
  cfg.userToken = token('second');
  assert.equal(pendingPostId(cfg, 'same post'), id);
});

test('three spinner write conflicts do not create phantom delivery and retry next tick', () => {
  const stat = fs.statSync;
  let clock = 0;
  fs.statSync = (file, ...args) => file === settingsPath ? { mtimeMs: ++clock } : stat(file, ...args);
  try { tick(); } finally { fs.statSync = stat; }
  assert.equal(cache.loadState().current, undefined);
  assert.deepEqual(queue.readEvents(), []);
  tick();
  assert.equal(cache.loadState().current.messageId, message.id);
  assert.equal(queue.readEvents().filter(e => e.type === 'DELIVERED').length, 1);
});

test('flush allows hooks during upload and preserves events appended after its snapshot', async () => {
  queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'before' });
  global.fetch = async () => {
    assert.equal(await withPingletLock(() => {
      queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'during-upload' });
      return true;
    }, { skipIfBusy: true }), true);
    return reply({ accepted: 1 });
  };
  await withCommandLock(runFlush);
  assert.deepEqual(queue.readEvents().map(e => e.messageId), ['during-upload']);
});

test('uninstall attempts old queue first, archives offline leftovers, and reinstall starts clean', async () => {
  cache.saveState({ seen: { message: 1 }, delivered: { message: 1 } });
  // Legacy queue has no installationId yet.
  fs.writeFileSync(config.EVENTS_PATH, JSON.stringify({ eventId: 'old-event', agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'old-message', occurredAt: new Date().toISOString() }) + '\n');
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/events/batch')) { assert.equal(options.headers.authorization, 'Bearer old-token'); return reply({}, 503); }
    return reply({ revoked: true });
  };
  await withCommandLock(() => runUninstall([]));
  assert.ok(calls[0].endsWith('/events/batch'));
  assert.deepEqual(queue.readEvents(), []);
  const archived = JSON.parse(fs.readFileSync(path.join(config.PINGLET_DIR, 'events-quarantine.jsonl'), 'utf8').trim());
  assert.equal(archived.event.installationId, 'old-install');
  assert.equal(cache.loadState().delivered, undefined);
  global.fetch = async url => {
    if (url.endsWith('/health')) return reply({ status: 'ok' });
    if (url.endsWith('/installations')) return reply({ installationId: 'new-install', token: 'new-token' });
    if (url.includes('/feed')) return reply({ items: [{ messageId: 'message', text: message.text, authorNickname: message.author }] });
    throw new Error('Unexpected request');
  };
  await withCommandLock(() => runInstall(['--claude', '--force']));
  tick();
  assert.equal(queue.readEvents()[0].installationId, 'new-install');
  assert.equal(queue.readEvents()[0].messageId, 'message');
});

test('stale installation events are never sent using a new installation credential', async () => {
  queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'old' });
  const cfg = config.loadConfig();
  cfg.installations.CLAUDE.installationId = 'new-install';
  config.saveConfig(cfg);
  let calls = 0;
  global.fetch = async () => { calls++; return reply({}); };
  await runFlush();
  assert.equal(calls, 0);
  assert.deepEqual(queue.readEvents(), []);
});

test('invalid local events and permanent server rejection are isolated without stranding good events', async () => {
  for (const messageId of ['invalid-local', 'bad-server', 'good']) queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId, ...(messageId === 'invalid-local' && { visibleMs: 2147483648 }) });
  const accepted = [];
  global.fetch = async (_, options) => {
    const events = JSON.parse(options.body).events;
    if (events.some(e => e.messageId === 'bad-server')) return reply({}, 400);
    accepted.push(...events.map(e => e.messageId));
    return reply({ accepted: events.length });
  };
  await runFlush();
  assert.deepEqual(accepted, ['good']);
  assert.deepEqual(queue.readEvents(), []);
  assert.equal(fs.readFileSync(path.join(config.PINGLET_DIR, 'events-quarantine.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('auth, rate limit and server errors retain queued events for retry', async () => {
  queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'retry' });
  for (const status of [401, 403, 429, 500, 503]) {
    global.fetch = async () => reply({}, status);
    await runFlush();
    assert.equal(queue.readEvents().length, 1);
  }
});

test('uninstall archives offline events even when registration never succeeded', async () => {
  const cfg = config.loadConfig();
  cfg.installations = {};
  config.saveConfig(cfg);
  queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'offline' });
  global.fetch = async () => reply({ revoked: true });
  await withCommandLock(() => runUninstall([]));
  assert.deepEqual(queue.readEvents(), []);
  assert.ok(fs.readFileSync(path.join(config.PINGLET_DIR, 'events-quarantine.jsonl'), 'utf8').includes('uninstalled-without-registration'));
});

test('malformed queue lines are preserved in quarantine, not silently discarded', async () => {
  fs.writeFileSync(config.EVENTS_PATH, '{unfinished\nnull\n{"type":"DELIVERED"}\n');
  queue.appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: 'valid' });
  global.fetch = async (_, options) => {
    assert.deepEqual(JSON.parse(options.body).events.map(e => e.messageId), ['valid']);
    return reply({ accepted: 1 });
  };
  await runFlush();
  assert.deepEqual(queue.readEvents(), []);
  const archived = fs.readFileSync(path.join(config.PINGLET_DIR, 'events-quarantine.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(archived.length, 3);
  assert.equal(archived[0].event.rawLine, '{unfinished');
});

test('changing installation identity resets old spinner attribution and delivery dedupe', () => {
  tick();
  assert.equal(cache.loadState().delivered.message, 1);
  const cfg = config.loadConfig();
  cfg.installations.CLAUDE.installationId = 'replacement-install';
  config.saveConfig(cfg);
  assert.equal(cache.loadState().current, undefined);
  tick();
  const events = queue.readEvents().filter(e => e.type === 'DELIVERED');
  assert.deepEqual(events.map(e => e.installationId), ['old-install', 'replacement-install']);
});

test('refresh HTTP waits allow local state writes and its commit preserves them', async () => {
  cache.saveState({ seen: { before: 1 } });
  global.fetch = async url => {
    if (url.includes('/feed')) {
      assert.equal(await withPingletLock(() => {
        const state = cache.loadState(); state.seen.during = 1; cache.saveState(state); return true;
      }, { skipIfBusy: true }), true);
      return reply({ items: [] });
    }
    return reply({ onlineInstallations: 2 });
  };
  await withCommandLock(runRefresh);
  assert.equal(cache.loadState().seen.during, 1);
});

test('dead recovery owner and old empty legacy recovery directory both recover', async () => {
  const lock = path.join(fixture, '.pinglet.lock');
  const recovery = lock + '.recovery';
  for (const mode of ['dead-owner', 'legacy-empty']) {
    fs.writeFileSync(lock, '2147483647:dead');
    fs.mkdirSync(recovery);
    if (mode === 'dead-owner') fs.writeFileSync(path.join(recovery, '2147483647-dead'), '');
    else fs.utimesSync(recovery, new Date(0), new Date(0));
    assert.equal(await withPingletLock(() => 42, { timeoutMs: 500 }), 42);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.existsSync(recovery), false);
  }
});

test('live or freshly initializing recovery owner is not reaped', async () => {
  const lock = path.join(fixture, '.pinglet.lock');
  const recovery = lock + '.recovery';
  fs.writeFileSync(lock, '2147483647:dead');
  fs.mkdirSync(recovery);
  await assert.rejects(withPingletLock(() => {}, { timeoutMs: 50 }), /busy/);
  const owner = path.join(recovery, `${process.pid}-live`);
  fs.writeFileSync(owner, '');
  await assert.rejects(withPingletLock(() => {}, { timeoutMs: 50 }), /busy/);
  assert.equal(fs.existsSync(owner), true);
  fs.unlinkSync(owner); fs.rmdirSync(recovery); fs.unlinkSync(lock);
});

test('unreadable or stale notification files are discarded without stopping the drain', async () => {
  const cfg = config.loadConfig();
  cfg.adapters.codex = { installedAt: 'generation-one', configPath: 'fixture' };
  config.saveConfig(cfg);
  const childProcess = require('node:child_process');
  const execFile = childProcess.execFile;
  childProcess.execFile = () => ({});
  try {
    const dir = config.PINGLET_DIR;
    fs.writeFileSync(path.join(dir, 'notify-aaaaaaaa-0000-4000-8000-000000000001.json'), '');
    fs.writeFileSync(path.join(dir, 'notify-aaaaaaaa-0000-4000-8000-000000000002.json'), 'null');
    const old = path.join(dir, 'notify-aaaaaaaa-0000-4000-8000-000000000003.json');
    fs.writeFileSync(old, JSON.stringify({ type: 'agent-turn-complete', installedAt: 'generation-one', apiBaseUrl: 'https://fixture.invalid' }));
    const past = new Date(Date.now() - 2 * 3600_000);
    fs.utimesSync(old, past, past);
    assert.equal(enqueueNotification([JSON.stringify({ type: 'agent-turn-complete' })]), true);
    assert.equal(queued().length, 4);
    await withPingletLock(drainNotifications);
    assert.equal(queued().length, 0);
    assert.equal(queue.readEvents().filter(e => e.agentType === 'CODEX').length, 1);
    tick();
    assert.equal(cache.loadState().current.messageId, message.id);
  } finally { childProcess.execFile = execFile; }
});

test('a delivery failure keeps its notification file for retry with the same event id', async () => {
  const cfg = config.loadConfig();
  cfg.adapters.codex = { installedAt: 'generation-one', configPath: 'fixture' };
  config.saveConfig(cfg);
  const childProcess = require('node:child_process');
  const execFile = childProcess.execFile;
  childProcess.execFile = () => ({});
  const eventsPath = path.join(config.PINGLET_DIR, 'events.jsonl');
  try {
    assert.equal(enqueueNotification([JSON.stringify({ type: 'agent-turn-complete' })]), true);
    fs.mkdirSync(eventsPath); // appendFileSync fails with EISDIR
    await withPingletLock(drainNotifications);
    assert.equal(queued().length, 1);
    fs.rmdirSync(eventsPath);
    const id = 'evt_' + queued()[0].slice('notify-'.length, -5);
    await withPingletLock(drainNotifications);
    assert.equal(queued().length, 0);
    assert.deepEqual(queue.readEvents().map(e => e.eventId), [id]);
  } finally { childProcess.execFile = execFile; fs.rmSync(eventsPath, { recursive: true, force: true }); }
});

test('unparseable settings.json settles a qualified impression once, not on every tick', () => {
  tick();
  const state = cache.loadState();
  assert.equal(state.current.messageId, message.id);
  state.current.visibleMs = runtime.QUALIFIED_MS;
  state.current.shownAt = 0;
  cache.saveState(state);
  fs.writeFileSync(settingsPath, '{broken');
  assert.throws(() => tick());
  assert.throws(() => tick());
  assert.equal(queue.readEvents().filter(e => e.type === 'QUALIFIED_IMPRESSION').length, 1);
  assert.equal(cache.loadState().current.visibleMs, 0);
});
