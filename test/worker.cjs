require('./home.cjs');
const { withPingletLock } = require('../dist/lock');
const { loadState, saveState } = require('../dist/cache');
const { appendEvent, readEvents, removeEvents } = require('../dist/queue');

(async () => {
  for (let i = 0; i < 20; i++) {
    await withPingletLock(async () => {
      const state = loadState();
      const before = state.seen.counter || 0;
      await new Promise(resolve => setTimeout(resolve, 1));
      state.seen.counter = before + 1;
      saveState(state);
      appendEvent({ agentType: 'CLAUDE', type: 'DELIVERED', messageId: `worker-${process.pid}-${i}` });
      removeEvents(new Set(readEvents().filter(e => e.messageId === 'sent').map(e => e.eventId)));
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
