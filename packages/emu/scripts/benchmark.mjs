/**
 * How fast Machine runs Sea Dragon, as a multiple of real time (spec §4: ≥ 20×). Boots the Model III
 * ROM from fugloy.mcp.json to READY (which also warms the JIT up), loads Sea Dragon, and times
 * `seconds` emulated seconds of the game (its title screen and attract loop), in one of two modes:
 *
 *   off      debugging off: no breakpoint, watch, hook, coverage, or trace
 *   debug    coverage on and a 10,000-deep trace
 *
 * Prints one JSON line: { mode, seconds, wall, ratio }. Run each mode in its own process: a
 * process's later Machine instances run slower (spec §12), so two modes in one process would not
 * measure the same thing. test/integration/benchmark.test.js runs it.
 *
 *   node packages/emu/scripts/benchmark.mjs off|debug [seconds = 20]
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { CPU_CLOCK_HZ } from '../src/index.js';
import { configuredRom } from '../test/rom.js';
import { bootToReady } from '../test/integration/boot-helpers.js';

const [mode, secondsArg = '20'] = process.argv.slice(2);
const seconds = Number(secondsArg);
if ((mode !== 'off' && mode !== 'debug') || !(seconds > 0)) {
  console.error('usage: node packages/emu/scripts/benchmark.mjs off|debug [seconds = 20]');
  process.exit(2);
}
const rom = configuredRom('model3');
if (rom === null) {
  console.error('no Model III ROM: name one as roms.model3 in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3)');
  process.exit(1);
}

const m = bootToReady(rom);
m.load.cmd(new Uint8Array(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url))));
if (mode === 'debug') {
  m.debug.coverage.enable();
  m.debug.trace.enable({ depth: 10_000 });
}
const start = performance.now();
m.run({ cycles: seconds * CPU_CLOCK_HZ });
const wall = (performance.now() - start) / 1000;
console.log(JSON.stringify({ mode, seconds, wall: Number(wall.toFixed(3)), ratio: Number((seconds / wall).toFixed(1)) }));
