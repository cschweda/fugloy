import { describe, expect, it } from 'vitest';
import { dosChoices, MACHINES, parseBase, selectionLabel } from '../app/utils/pickers';

describe('parseBase (the raw binary load address)', () => {
  it('reads hex, with or without $, 0x, or a trailing H', () => {
    expect(parseBase('5200')).toEqual({ base: 0x5200 });
    expect(parseBase('$7000')).toEqual({ base: 0x7000 });
    expect(parseBase('0x4a00')).toEqual({ base: 0x4a00 });
    expect(parseBase(' 8000H ')).toEqual({ base: 0x8000 });
    expect(parseBase('0')).toEqual({ base: 0 });
    expect(parseBase('FFFF')).toEqual({ base: 0xffff });
  });

  it('refuses anything outside 0-FFFF or not hex', () => {
    for (const bad of ['', '10000', 'G000', '-1', '12 34', '$']) expect(parseBase(bad), bad).toHaveProperty('error');
  });
});

describe('machine and DOS choices', () => {
  it('offers Model I, Model III, and Model 4', () => {
    expect(MACHINES.map((m) => m.label)).toEqual(['Model I', 'Model III', 'Model 4']);
  });

  it('offers only the DOSes each machine has tables for', () => {
    expect(dosChoices(1).map((d) => d.dos)).toEqual(['ldos', 'none']);
    expect(dosChoices(3).map((d) => d.dos)).toEqual(['trsdos', 'ldos', 'none']);
    expect(dosChoices(4).map((d) => d.dos)).toEqual(['none']);
  });

  it('labels a selection for the status line', () => {
    expect(selectionLabel({ machine: 3, dos: 'trsdos' })).toBe('Model III · TRSDOS 1.3');
    expect(selectionLabel({ machine: 1, dos: 'none' })).toBe('Model I · no DOS');
    expect(selectionLabel({ machine: 4, dos: 'none' })).toBe('Model 4 · LS-DOS 6 service calls');
  });
});
