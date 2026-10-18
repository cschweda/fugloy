/**
 * The emulator's label file for Sea Dragon in the disassembler. examples/sea-dragon/seadrg01.labels.json
 * was written by a scripted session (packages/emu/scripts/sea-dragon-labels.mjs: boot, load, coverage
 * on, title screen, ENTER), and is committed, so this runs everywhere without a ROM. Applied together
 * with the committed hints, it agrees with them at every instruction that ran and adds the observed
 * call counts; applied alone, it states nothing about the file's bytes that did not run there.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLabelFile } from '../src/labels/format.js';
import type { LabelFile } from '../src/labels/format.js';
import { openProgram, renderSession, withHintText, withLabelFile } from '../src/session.js';
import type { Session } from '../src/session.js';

const dir = new URL('../../../examples/sea-dragon/', import.meta.url);
const bytes = new Uint8Array(readFileSync(new URL('seadrg01.cmd', dir)));
const hintText = readFileSync(new URL('seadrg01.hints', dir), 'utf8');
const labels = (): LabelFile => {
  const { file, errors } = parseLabelFile(readFileSync(new URL('seadrg01.labels.json', dir), 'utf8'));
  expect(errors).toEqual([]);
  return file!;
};

const overlaps = (s: Session): string[] => s.analysis.pass1.diagnostics.filter((d) => d.kind === 'overlap').map((d) => d.message);

describe('Sea Dragon with the emulator\'s label file', () => {
  const hinted = withHintText(openProgram(bytes, { name: 'seadrg01.cmd' }), hintText, 'seadrg01.hints');
  const both = withLabelFile(hinted, labels(), 'seadrg01.labels.json');

  it('is the label file for this program, and applies without warnings', () => {
    expect(labels().program.sha256).toBe(hinted.hash);
    expect(both.analysis.labels?.warnings).toEqual([]);
    expect(renderSession(both, 'listing')).toMatch(/^; labels: seadrg01\.labels\.json: \d+ names?, \d+ roots, \d+ data runs? applied$/m);
  });

  it('agrees with the hints: every instruction that ran starts an instruction the hints decode', () => {
    // The label file's roots are the instructions that ran, at runtime addresses; the relocate hint puts the game there.
    const ran = both.analysis.annotations.labelRoots ?? [];
    expect(ran.length).toBeGreaterThan(400);
    for (const addr of ran) expect(hinted.analysis.pass1.instructions.has(addr), `$${addr.toString(16)}`).toBe(true);
    expect(both.analysis.pass1.roots.length).toBeGreaterThan(hinted.analysis.pass1.roots.length);
  });

  it('adds what the session observed: call counts on the subroutines it saw called', () => {
    const observed = (s: Session): number => (renderSession(s, 'listing').match(/; observed: called \d+× from \d+ sites?/g) ?? []).length;
    expect(observed(hinted)).toBe(0);
    // The title screen calls 9 subroutines; the 3 at or above $5200 are inside the loaded blocks (Ruling 9).
    expect(observed(both)).toBe(3);
    // Each sits on an instruction both decode.
    for (const [addr, text] of both.analysis.annotations.comments) {
      if (text.startsWith('observed: ')) expect(both.analysis.pass1.instructions.has(addr), `$${addr.toString(16)}`).toBe(true);
    }
  });

  it('loses no code', () => {
    // Every instruction the hints decode is still decoded: no read-only run of the label file
    // (applied as data) cuts the descent short. Coverage taken across the loader's copy would.
    for (const addr of hinted.analysis.pass1.instructions.keys()) expect(both.analysis.pass1.instructions.has(addr), `$${addr.toString(16)}`).toBe(true);
  });

  it('adds no overlap diagnostics', () => {
    expect(overlaps(both)).toEqual(overlaps(hinted));
  });

  it('without the hints, decodes no instruction whose bytes differ from what ran, and says what it skipped', () => {
    // The stub at $8881 copies $3681 bytes from $5200 down to $497F; at runtime $497F-$7FFF holds the game.
    const runtime = (a: number): number | undefined => (a >= 0x497f && a < 0x497f + 0x3681 ? bare.module.image.read(a - 0x497f + 0x5200) : bare.module.image.read(a));
    const plain = openProgram(bytes, { name: 'seadrg01.cmd' });
    const bare = withLabelFile(plain, labels(), 'seadrg01.labels.json');
    const p = bare.analysis.pass1;
    expect(p.instructions.size).toBeGreaterThanOrEqual(plain.analysis.pass1.instructions.size);
    expect(p.instructions.size).toBeLessThan(20);
    for (const [addr, ins] of p.instructions) {
      for (let k = 0; k < ins.length; k++) expect(bare.module.image.read(addr + k), `$${(addr + k).toString(16)}`).toBe(runtime(addr + k));
    }
    expect(overlaps(bare)).toEqual([]);
    expect(bare.analysis.labels?.warnings).toEqual([
      "165 executed or labelled addresses changed at runtime (written while coverage was on, or since the load); their coverage is not applied to the file's bytes (a relocate hint says where moved code runs)",
    ]);
  });

  it('keeps every hint name', () => {
    const hintNames = [...hinted.analysis.annotations.names];
    expect(hintNames.length).toBeGreaterThan(0);
    for (const [addr, name] of hintNames) {
      expect(both.analysis.annotations.names.get(addr), name).toBe(name);
      expect(both.analysis.symbols.get(addr)?.name, name).toBe(hinted.analysis.symbols.get(addr)?.name);
    }
  });
});
