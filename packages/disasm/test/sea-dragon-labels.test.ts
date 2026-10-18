/**
 * The emulator's label file for Sea Dragon in the disassembler. examples/sea-dragon/seadrg01.labels.json
 * was written by a scripted session (packages/emu/scripts/sea-dragon-labels.mjs: boot, load, coverage
 * on, title screen, ENTER), and is committed, so this runs everywhere without a ROM. Applied together
 * with the committed hints, it adds roots and states nothing the hints contradict.
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

  it('finds more roots than the hints alone, and loses no code', () => {
    expect(both.analysis.pass1.roots.length).toBeGreaterThan(hinted.analysis.pass1.roots.length);
    // Every instruction the hints decode is still decoded: no read-only run of the label file
    // (applied as data) cuts the descent short. Coverage taken across the loader's copy would.
    for (const addr of hinted.analysis.pass1.instructions.keys()) expect(both.analysis.pass1.instructions.has(addr), `$${addr.toString(16)}`).toBe(true);
  });

  it('adds no overlap diagnostics', () => {
    expect(overlaps(both)).toEqual(overlaps(hinted));
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
