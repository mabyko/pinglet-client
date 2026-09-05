// Loaded only by test child processes. Never changes the real user's home.
const os = require('node:os');
if (!process.env.PINGLET_TEST_HOME) throw new Error('Missing isolated test home');
os.homedir = () => process.env.PINGLET_TEST_HOME;
