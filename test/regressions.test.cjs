const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pinglet-client-test-'));
os.homedir = () => testHome;
const config = require('../dist/config');
const { runUninstall } = require('../dist/commands/uninstall');
const { runLogout } = require('../dist/commands/logout');
const { runLogin } = require('../dist/commands/login');
const claude = require('../dist/adapters/claude');
const cache = require('../dist/cache');
const api = require('../dist/api');
const { withPingletLock } = require('../dist/lock');
const settingsPath = path.join(testHome, '.claude/settings.json');
const originalFetch = global.fetch;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fs.rmSync(config.PINGLET_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'original', statusLine: { command: 'pinglet statusline' } }));
  config.saveConfig({ apiBaseUrl: 'https://fixture.invalid', createdAt: '2026-09-05', userToken: 'user-token',
    installations: { CLAUDE: { installationId: 'installation', token: 'installation-token', registeredAt: '2026-09-05' } },
    adapters: { claude: { installedAt: '2026-09-05', settingsPath, statusLineBackup: { command: 'original' } } } });
  global.fetch = async () => { throw new Error('Unexpected network request'); };
});
after(() => { global.fetch = originalFetch; fs.rmSync(testHome, { recursive: true, force: true }); });

test('uninstall restores settings, revokes credentials and only then purges', async () => {
  const calls = [];
  global.fetch = async (url, options) => { calls.push([url, options.method]); return reply({ revoked: true }); };
  await withPingletLock(() => runUninstall(['--purge']));
  assert.equal(fs.existsSync(config.PINGLET_DIR), false);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath)).statusLine.command, 'original');
  assert.deepEqual(calls.map(c => c[0].split('/').pop()), ['current', 'logout']);
  assert.equal(calls[0][1], 'DELETE');
  assert.ok(fs.existsSync(path.join(__dirname, '../dist/cli.js')), 'package is not deleted');
});

test('failed server revocation prevents purge and preserves retry credentials', async () => {
  await assert.rejects(runUninstall(['--purge']));
  assert.equal(config.loadConfig().userToken, 'user-token');
  assert.equal(config.loadConfig().installations.CLAUDE.token, 'installation-token');
});

test('logout unlinks installations and revokes user JWT but keeps anonymous reading', async () => {
  const calls = [];
  global.fetch = async url => { calls.push(url); return reply({ unlinked: true, revoked: true }); };
  await runLogout();
  assert.equal(config.loadConfig().userToken, undefined);
  assert.ok(config.loadConfig().installations.CLAUDE);
  assert.ok(config.loadConfig().adapters.claude);
  assert.ok(calls[0].endsWith('/installations/unlink'));
  assert.ok(calls[1].endsWith('/auth/logout'));
});

test('logout failure keeps credentials and retry of already-revoked installation works', async () => {
  await assert.rejects(runLogout());
  assert.equal(config.loadConfig().userToken, 'user-token');
  global.fetch = async url => reply({}, url.endsWith('/unlink') ? 401 : 503);
  await assert.rejects(runLogout());
  assert.equal(config.loadConfig().userToken, 'user-token');
});

test('three Claude write conflicts preserve backups and prevent purge', async () => {
  const originalStat = fs.statSync;
  let clock = 0;
  fs.statSync = (p, ...args) => p === settingsPath ? { mtimeMs: ++clock } : originalStat(p, ...args);
  try { await assert.rejects(runUninstall(['--purge'])); }
  finally { fs.statSync = originalStat; }
  assert.equal(JSON.parse(fs.readFileSync(settingsPath)).statusLine.command, 'pinglet statusline');
  assert.equal(config.loadConfig().adapters.claude.statusLineBackup.command, 'original');
});

test('malformed Claude settings are preserved during install and uninstall', async () => {
  const damaged = '{"theme":"valuable",';
  fs.writeFileSync(settingsPath, damaged);
  assert.throws(() => claude.installClaudeIntegration(config.loadConfig()));
  await assert.rejects(runUninstall(['--purge']));
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), damaged);
  assert.ok(config.loadConfig().adapters.claude);
});

test('malformed Pinglet config is never replaced by fresh defaults', () => {
  for (const damaged of ['{', 'null', '[]', '{"adapters":false}']) {
    fs.writeFileSync(config.CONFIG_PATH, damaged);
    assert.throws(() => config.loadConfig());
    assert.equal(fs.readFileSync(config.CONFIG_PATH, 'utf8'), damaged);
  }
});

test('invalid login preserves old token; valid login verifies before replacing', async () => {
  global.fetch = async () => reply({}, 401);
  await runLogin(['--token', 'not-a-jwt', '--quiet']);
  assert.equal(config.loadConfig().userToken, 'user-token');
  const calls = [];
  global.fetch = async url => {
    calls.push(url);
    return reply(url.endsWith('/users/me') ? { id: 'user-new' } : { revoked: true, linked: true });
  };
  await runLogin(['--token', 'valid-new-token', '--quiet']);
  assert.equal(config.loadConfig().userToken, 'valid-new-token');
  assert.ok(calls[0].endsWith('/users/me'));
});

test('expired messages and stale or future-dated feeds cannot be rendered', () => {
  const messages = [
    { id: 'expired', expiresAt: new Date(Date.now() - 1).toISOString() },
    { id: 'fresh', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { id: 'system', expiresAt: null },
  ];
  cache.saveFeedMessages(messages);
  assert.deepEqual(cache.loadFeedMessages().map(m => m.id), ['fresh', 'system']);
  for (const fetchedAt of ['2000-01-01', 'invalid', '2999-01-01']) {
    config.writeJsonFile(config.FEED_PATH, { fetchedAt, messages });
    assert.deepEqual(cache.loadFeedMessages(), []);
  }
});

test('posting sends a reusable idempotency key and feed preserves expiry', async () => {
  global.fetch = async (url, options) => {
    if (url.endsWith('/messages')) {
      assert.equal(JSON.parse(options.body).requestId, 'request-identity');
      return reply({ id: 'message', status: 'APPROVED' });
    }
    return reply({ items: [{ messageId: 'message', text: 'hi', expiresAt: '2026-10-01' }] });
  };
  await api.createMessage(config.loadConfig(), 'hi', undefined, 'request-identity');
  assert.equal((await api.fetchFeed(config.loadConfig(), config.loadConfig().installations.CLAUDE))[0].expiresAt, '2026-10-01');
});

test('retry journal preserves an ambiguous post ID and clears it after success', () => {
  const { pendingPostId, completePost } = require('../dist/pending-post');
  const cfg = config.loadConfig();
  const first = pendingPostId(cfg, 'same text', 'category');
  assert.equal(pendingPostId(cfg, 'same text', 'category'), first);
  assert.notEqual(pendingPostId(cfg, 'other text', 'category'), first);
  completePost(first);
  assert.notEqual(pendingPostId(cfg, 'same text', 'category'), first);
  const raw = fs.readFileSync(path.join(config.PINGLET_DIR, 'pending-posts.json'), 'utf8');
  assert.equal(raw.includes(cfg.userToken), false);
  assert.equal(raw.includes('same text'), false);
});

test('malformed Codex notify preserves both configuration and restoration backup', async () => {
  const codex = require('../dist/adapters/codex');
  const tomlPath = path.join(testHome, '.codex/config.toml');
  fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
  const damaged = 'notify = ["node", "pinglet", # unfinished array\n';
  fs.writeFileSync(tomlPath, damaged);
  const cfg = config.loadConfig();
  cfg.adapters.codex = { installedAt: '2026-09-05', configPath: tomlPath, notifyBackup: 'notify = ["original"]' };
  config.saveConfig(cfg);
  assert.throws(() => codex.uninstallCodexIntegration(cfg), /Invalid notify/);
  assert.throws(() => codex.installCodexIntegration(cfg), /Invalid notify/);
  assert.equal(fs.readFileSync(tomlPath, 'utf8'), damaged);
  assert.equal(config.loadConfig().adapters.codex.notifyBackup, 'notify = ["original"]');
  fs.unlinkSync(tomlPath);
});

test('legacy spinner tips backup survives failed restore writes', async () => {
  const cfg = config.loadConfig();
  cfg.adapters.claude.spinnerTipsBackup = { tips: ['original tip'] };
  config.saveConfig(cfg);
  fs.writeFileSync(settingsPath, JSON.stringify({ spinnerTipsOverride: { tips: ['\u200bpinglet tip'] } }));
  const originalStat = fs.statSync;
  let clock = 0;
  fs.statSync = (p, ...args) => p === settingsPath ? { mtimeMs: ++clock } : originalStat(p, ...args);
  try { await assert.rejects(runUninstall(['--purge'])); }
  finally { fs.statSync = originalStat; }
  assert.deepEqual(config.loadConfig().adapters.claude.spinnerTipsBackup, { tips: ['original tip'] });
});

test('stale hooks after purge cannot recreate user data or start maintenance', () => {
  fs.rmSync(config.PINGLET_DIR, { recursive: true, force: true });
  require('../dist/commands/statusline').runStatusline();
  require('../dist/commands/notify').runNotify([]);
  assert.equal(fs.existsSync(config.PINGLET_DIR), false);
});

test('six concurrent processes preserve every state update and newly appended event', async () => {
  const processes = Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'worker.cjs')], {
      env: { ...process.env, PINGLET_TEST_HOME: testHome }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(output || `exit ${code}`)));
  }));
  await Promise.all(processes);
  assert.equal(cache.loadState().seen.counter, 120);
  assert.equal(require('../dist/queue').readEvents().length, 120);
  assert.equal(fs.readdirSync(config.PINGLET_DIR).some(name => name.endsWith('.tmp')), false);
});

test('busy hooks skip immediately and locks are released after failure', async () => {
  await withPingletLock(async () => {
    let ran = false;
    await withPingletLock(() => { ran = true; }, { skipIfBusy: true });
    assert.equal(ran, false);
  });
  await assert.rejects(withPingletLock(() => { throw new Error('fixture'); }));
  assert.equal(await withPingletLock(() => 42), 42);
});
