// Local only: the Run tab's boot on a real ROM, the one the gitignored fugloy.mcp.json names for
// each model (as emulator-run.test.ts reads it). Without it these skip, so CI and a clean worktree
// pass. The boot answers the ROM's prompts and reaches READY, its snapshot is kept, and the starter
// blanks the screen from it.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '@fugloy/asm';
import { Machine } from '@fugloy/emu';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import { bootedSnapshot, prepareMachine } from '../app/utils/emulator/boot';
import { createRunner } from '../app/utils/emulator/runner';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

/** The ROM fugloy.mcp.json (or $FUGLOY_CONFIG) names under `roms.<key>`; null when there is none. */
function configuredRom(key: 'model1' | 'model3' | 'model4'): Uint8Array | null {
  const config = process.env.FUGLOY_CONFIG || resolve(repo, 'fugloy.mcp.json');
  if (!existsSync(config)) return null;
  const entry = (JSON.parse(readFileSync(config, 'utf8')).roms ?? {})[key] as string | undefined;
  if (entry === undefined) return null;
  const path = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

const blank = (m: Machine): boolean => m.video.text().every((row) => row === ' '.repeat(64));

for (const [model, key, name] of [
  [3, 'model3', 'Model III'],
  [1, 'model1', 'Model I'],
  [4, 'model4', 'Model 4'],
] as const) {
  const rom = configuredRom(key);
  describe.skipIf(rom === null)(`the boot on a real ${name} ROM`, { timeout: 60_000 }, () => {
    it('reaches READY, and the snapshot is kept for the page session', () => {
      const snap = bootedSnapshot(model, rom!);
      expect(bootedSnapshot(model, rom!)).toBe(snap);
      const m = new Machine({ model, roms: { level2: rom! } });
      m.debug.restore(snap);
      const lines = m.video.text().map((l) => l.trimEnd()).filter((l) => l !== '');
      // READY, then BASIC's prompt as the last line: past every question.
      expect(lines.at(-2)).toBe('READY');
      expect(lines.at(-1)).toMatch(/^>/);
    });

    it('the starter blanks the screen from it', () => {
      const result = assemble(starter, { model });
      const m = prepareMachine({ model, rom: rom!, result });
      expect(blank(m)).toBe(false);
      let now = 0;
      let queued: (() => void) | null = null;
      const runner = createRunner({ machine: m, result, stub: false, schedule: (cb) => ((queued = cb), 1), cancel: () => (queued = null), now: () => now });
      runner.start();
      for (let k = 0; k < 4; k++) {
        now += 1000 / 60;
        const cb = queued as (() => void) | null;
        queued = null;
        cb?.();
      }
      expect(runner.state).toBe('running');
      expect(runner.pc).toBe(result.symbol('WAIT')!.value);
      expect(blank(m)).toBe(true);
    });
  });
}
