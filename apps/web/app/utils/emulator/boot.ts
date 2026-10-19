// Booting a machine for the Run tab (phase 5B Ruling 6). A ROM boots to READY once per ROM per page
// session, answering its prompts (Cass? and Memory Size? on the Model III and 4, SIZE? on the
// Model I) within 8 emulated seconds, and its snapshot is kept in memory. The stub ROM boots to its
// HALT. Each Run restores the snapshot on a new Machine and loads the program's .CMD.
import { toCmd } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { sha256Hex } from '@fugloy/disasm';
import { Machine } from '@fugloy/emu';
import type { Model, Snapshot } from '@fugloy/emu';
import { MODEL_NAMES } from './rom-ids';
import { isStub } from './stub-rom';

/** The longest a ROM may take to reach READY, in emulated seconds. */
export const BOOT_SECONDS = 8;
/** How often the boot looks at the screen, in emulated seconds. */
const SLICE = 0.05;

/** A failure already worded as a sentence with its next step: shown as it is. */
export class SentenceError extends Error {
  override name = 'SentenceError';
}

/**
 * The booted snapshots: one for each model's stub and one for the ROM last run on each model, with
 * that ROM's SHA-256. A replaced ROM's snapshot is dropped when the new one boots.
 */
const snapshots = new Map<string, { hash: string; snap: Snapshot }>();
/**
 * Each ROM array's SHA-256, so a Run with the same array does not hash it again. useRoms hands every
 * Run the same array for a model, and stubRom the same array for its model, so this hits.
 */
const hashes = new WeakMap<Uint8Array, string>();

function hashOf(rom: Uint8Array): string {
  let h = hashes.get(rom);
  if (h === undefined) {
    h = sha256Hex(rom);
    hashes.set(rom, h);
  }
  return h;
}

const screen = (m: Machine): string => m.video.text().join('\n');

/** Runs a real ROM to READY, pressing ENTER at each prompt; throws a sentence if it never gets there. */
function bootToReady(m: Machine, model: Model): void {
  const prompts = model === 1 ? [/SIZE\?/] : [/Cass ?\?/, /Memory Size\?/];
  let answered = 0;
  let quiet = 0;
  for (let t = 0; t < BOOT_SECONDS; t += SLICE) {
    m.run({ cycles: Math.round(m.clockHz * SLICE) });
    const text = screen(m);
    if (/READY/.test(text)) {
      // Let the ROM print its prompt and settle in its keyboard wait.
      m.run({ cycles: Math.round(m.clockHz * 0.1) });
      return;
    }
    const next = prompts[answered];
    if (next !== undefined && next.test(text) && ++quiet >= 2) {
      m.keyboard.type('\n', model === 1 ? { cps: 10 } : undefined);
      answered++;
      quiet = 0;
    }
  }
  throw new SentenceError(
    `The ROM did not reach READY within ${BOOT_SECONDS} emulated seconds, so Fugløy cannot run programs on it. Check that it is a ${MODEL_NAMES[model]} ROM, or remove it to run on Fugløy's stand-in.`,
  );
}

/** The machine just booted from `rom`: at READY for a real ROM, halted with a blank screen for the stub. Cached by model and the ROM's SHA-256. */
export function bootedSnapshot(model: Model, rom: Uint8Array): Snapshot {
  const stub = isStub(model, rom);
  const key = `${model}:${stub ? 'stub' : 'rom'}`;
  const hash = hashOf(rom);
  const hit = snapshots.get(key);
  if (hit !== undefined && hit.hash === hash) return hit.snap;
  const m = new Machine({ model, roms: { level2: rom } });
  if (stub) {
    const r = m.run({ until: 'halt', cycles: m.clockHz });
    if (r.reason !== 'halt') throw new SentenceError("Fugløy's stand-in ROM did not finish starting. Reload the page and run the program again.");
  } else bootToReady(m, model);
  const snap = m.debug.snapshot();
  snapshots.set(key, { hash, snap });
  return snap;
}

/** How many booted snapshots are kept (tests). */
export function snapshotCount(): number {
  return snapshots.size;
}

/**
 * A new machine for one Run: booted (from the cached snapshot), then `before` (a test's hook), then
 * the program's .CMD loaded, which leaves PC at its entry. `cmd` is that .CMD when the caller has
 * already written it (a Run has, for the listing, and a Program to try is one); otherwise it is
 * written from `result`. One of the two is required.
 */
export function prepareMachine(opts: { model: Model; rom: Uint8Array; result?: AsmResult; cmd?: Uint8Array; before?: ((m: Machine) => void) | undefined }): Machine {
  if (opts.cmd === undefined && opts.result === undefined) throw new Error('prepareMachine needs a program: a result or a .CMD.');
  const snap = bootedSnapshot(opts.model, opts.rom);
  const m = new Machine({ model: opts.model, roms: { level2: opts.rom } });
  m.debug.restore(snap);
  opts.before?.(m);
  m.load.cmd(opts.cmd ?? toCmd(opts.result!));
  return m;
}

/**
 * The TRS-80 just switched on (phase 5D): a fresh machine on `rom`, nothing run and nothing typed.
 * The frame loop runs its boot live, so a ROM that never reaches READY cannot hang the page.
 */
export function powerOnMachine(model: Model, rom: Uint8Array): Machine {
  return new Machine({ model, roms: { level2: rom } });
}
