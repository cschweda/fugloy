import { describe, expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { basStructure } from '../../src/basic/structure.js';
import { BAS_FIXTURES, SIX_LINES } from '../fixtures.js';

const prog = (name: string) => loadBas(BAS_FIXTURES[name]!());

describe('basStructure', () => {
  it('types headers as words, BASIC bodies as bytes with their text, terminators as bytes, and the end marker as a word', () => {
    const p = prog('prog-7000');
    const s = basStructure(p);
    // Line 10 is CLS:PRINT"VOYAGE OF THE VALKYRIE": 27 body bytes at $7004, its 00 at $701F, line 20 at $7020.
    expect(s.annotations.overrides.slice(0, 4)).toEqual([
      { addr: 0x7000, kind: 'words', length: 4 },
      { addr: 0x7004, kind: 'bytes', length: 27 },
      { addr: 0x701f, kind: 'bytes', length: 1 },
      { addr: 0x7020, kind: 'words', length: 4 },
    ]);
    expect(s.annotations.overrides).toEqual([
      ...p.lines.flatMap((l) => [
        { addr: l.addr, kind: 'words', length: 4 },
        { addr: l.bodyAddr, kind: 'bytes', length: l.body.length - 1 },
        { addr: l.bodyAddr + l.body.length - 1, kind: 'bytes', length: 1 },
      ]),
      { addr: p.end, kind: 'words', length: 2 },
    ]);
    expect(s.annotations.entries).toEqual([]);
    expect([...s.texts]).toEqual(p.lines.map((l, i) => [l.bodyAddr, `${SIX_LINES[i]!.number} ${SIX_LINES[i]!.text}`]));
    expect(s.texts.get(0x7004)).toBe('10 CLS:PRINT"VOYAGE OF THE VALKYRIE"');
  });

  it('roots a code line at its body start and types only its header and terminator', () => {
    const s = basStructure(prog('hidden-code'));
    expect(s.annotations.entries).toEqual([0x700d]);
    expect(s.annotations.overrides).toEqual([
      { addr: 0x7000, kind: 'words', length: 4 },
      { addr: 0x7004, kind: 'bytes', length: 4 },
      { addr: 0x7008, kind: 'bytes', length: 1 },
      { addr: 0x7009, kind: 'words', length: 4 },
      { addr: 0x7013, kind: 'bytes', length: 1 },
      { addr: 0x7014, kind: 'words', length: 4 },
      { addr: 0x7018, kind: 'bytes', length: 1 },
      { addr: 0x7019, kind: 'bytes', length: 1 },
      { addr: 0x701a, kind: 'words', length: 2 },
    ]);
    expect([...s.texts]).toEqual([
      [0x7004, '10 GOTO 30'],
      [0x7018, '30 END'],
    ]);
  });
});
