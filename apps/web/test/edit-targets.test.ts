import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listingRows, openProgram, withHintText } from '@fugloy/disasm';
import { editTargets, followOf, markRange, stepCursor } from '../app/utils/edit-targets';

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

function seaDragon() {
  const s = openProgram(new Uint8Array(readFileSync(repo('examples/sea-dragon/seadrg01.cmd'))), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } });
  return withHintText(s, readFileSync(repo('examples/sea-dragon/seadrg01.hints'), 'utf8'));
}

/** LD A,(9000H) / CALL 0049H / RET at $7000, loaded raw. */
const raw = () => openProgram(Uint8Array.from([0x3a, 0x00, 0x90, 0xcd, 0x49, 0x00, 0xc9]), { name: 't.bin', base: 0x7000, selection: { machine: 3, dos: 'trsdos' } });

describe('stepCursor', () => {
  it('moves to the next and previous instruction rows, past labels', () => {
    const rows = listingRows(seaDragon().analysis);
    // $499A CALL SUB_4B9E is three bytes; SUB_4B9E's label row sits before $4B9E.
    expect(stepCursor(rows, 0x499a, 1)).toBe(0x499d);
    expect(stepCursor(rows, 0x499d, -1)).toBe(0x499a);
    const before = stepCursor(rows, 0x4b9e, -1)!;
    expect(before).toBeLessThan(0x4b9e);
    expect(stepCursor(rows, before, 1)).toBe(0x4b9e);
  });
  it('stays put at either end, and starts at the first row with no cursor', () => {
    const rows = listingRows(raw().analysis);
    expect(stepCursor(rows, 0x7006, 1)).toBeNull();
    expect(stepCursor(rows, 0x7000, -1)).toBeNull();
    expect(stepCursor(rows, null, 1)).toBe(0x7000);
  });
});

describe('markRange', () => {
  it('covers the cursor row, or every selected row through the last one’s last byte', () => {
    const rows = listingRows(raw().analysis);
    expect(markRange(rows, 0x7003, null)).toEqual({ from: 0x7003, to: 0x7005 });
    expect(markRange(rows, 0x7003, { from: 0x7000, to: 0x7003 })).toEqual({ from: 0x7000, to: 0x7005 });
    expect(markRange(rows, null, null)).toBeNull();
  });
});

describe('editTargets', () => {
  it('offers the row itself, then the addresses outside the program its operands name', () => {
    const s = raw();
    expect(editTargets(s, 0x7000).map((t) => t.addr)).toEqual([0x7000, 0x9000]);
    expect(editTargets(s, 0x7003).map((t) => t.addr)).toEqual([0x7003, 0x0049]);
    expect(editTargets(s, 0x7006).map((t) => t.addr)).toEqual([0x7006]);
  });
});

describe('followOf', () => {
  it("is the row's first link, with what kind of name it is", () => {
    const rows = listingRows(seaDragon().analysis);
    const call = rows.find((r) => r.kind === 'code' && r.addr === 0x499a)!;
    expect(followOf(call)).toEqual({ target: 0x4b9e, info: { span: 'label', use: 'addr' } });
    const out = rows.find((r) => r.kind === 'code' && r.addr === 0x499f)!;
    expect(followOf(out)).toMatchObject({ target: 0xec, info: { span: 'table', use: 'port', table: 'hardware-model3', key: 0xec } });
    expect(followOf({ kind: 'blank' })).toBeNull();
  });
});
