/**
 * The scripted session behind the committed examples/sea-dragon/seadrg01.labels.json: boot the
 * Model III ROM to READY, load Sea Dragon with m.load.cmd, run its loader stub to $497F, turn
 * coverage on, run to the title screen as test/integration/programs.test.js does, hold ENTER, and
 * run to "1 or 2 Players?".
 *
 * Coverage starts at $497F, after the stub at $8881 has copied the game down from $5200 with LDIR.
 * The label file still says what the copy did: `write` marks every loaded byte that differs now
 * from what the load placed, so the disassembler, reading the file's bytes, skips the game's
 * runtime coverage wherever the copy overwrote the file's $5200-$7FFF (unless a relocate hint says
 * the game runs there). Started at $497F, the game's own data reads show as read-only runs; from
 * the load (`{ fromLoad: true }`, what label-session.test.js also checks) the copy writes every
 * byte of the game, so none does, and nothing is lost either way.
 * Shared by label-session.test.js, which checks the committed file against it, and
 * scripts/sea-dragon-labels.mjs, which writes it. No `started`, so the file is reproducible.
 */
import { readFileSync } from 'node:fs';
import { CPU_CLOCK_HZ } from '../../src/index.js';
import { bootToReady, waitFor } from './boot-helpers.js';

export const SEA_DRAGON_CMD = new URL('../../../../examples/sea-dragon/seadrg01.cmd', import.meta.url);
export const SEA_DRAGON_LABELS = new URL('../../../../examples/sea-dragon/seadrg01.labels.json', import.meta.url);

export const TITLE = 'BY: Wayne Westmoreland & Terry Gilman';
export const PROMPT = '1 or 2 Players?';
export const NAME = 'seadrg01.cmd'; // the file has no name record
export const INPUT = 'ENTER at Cass? and Memory Size?, then (coverage on from $497F) ENTER held 1 s at the title screen';
/** Where the stub jumps once the game is copied down. */
export const GAME_START = 0x497f;

/**
 * The session's Machine, with coverage on from $497F (or from the load) to the "1 or 2 Players?" prompt.
 * @param {Uint8Array} rom
 * @param {{ fromLoad?: boolean }} [opts]
 */
export function seaDragonMachine(rom, { fromLoad = false } = {}) {
  const m = bootToReady(rom);
  m.load.cmd(new Uint8Array(readFileSync(SEA_DRAGON_CMD)));
  if (fromLoad) m.debug.coverage.enable();
  const id = m.debug.break(GAME_START, { once: true });
  const r = m.run({ cycles: CPU_CLOCK_HZ });
  if (r.reason !== 'break' || r.id !== id) throw new Error(`Sea Dragon's stub did not reach $497F: ${JSON.stringify(r)}`);
  m.debug.coverage.enable();
  waitFor(m, TITLE, 10);
  m.run({ cycles: CPU_CLOCK_HZ / 2 });
  m.keyboard.type('\n', { cps: 1 });
  waitFor(m, PROMPT, 3);
  return m;
}

/** The label file's text, as written to disk. */
export function seaDragonLabelText(rom) {
  return `${JSON.stringify(seaDragonMachine(rom).debug.labelFile({ name: NAME, input: INPUT }), null, 2)}\n`;
}
