/**
 * Preloaded (node --import) into the real bin by the stdout test. When the client's tools/list
 * arrives (initialize has been answered, so the server's stdout guard is in place), print through
 * every console method that writes to stdout by default, and make a Machine built by the session's
 * own factory, from the server's own config, log a line. All of it must land on stderr.
 */
import { homedir } from 'node:os';
import { loadConfig } from '../../src/config.js';
import { makeMachine } from '../../src/session.js';

let fired = false;
process.stdin.on('data', (chunk) => {
  if (fired || !String(chunk).includes('"tools/list"')) return;
  fired = true;
  console.log('noisy-log');
  console.info('noisy-info');
  console.debug('noisy-debug');
  console.dir('noisy-dir');
  const machine = makeMachine(loadConfig({ cwd: process.cwd(), env: process.env, home: homedir() }));
  machine.system.io.cassette.loadTape(new Uint8Array([1, 2, 3]));
});
