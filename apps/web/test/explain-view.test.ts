// The Explain tab's cache and helpers (app/utils/explain-view.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProgram, sentenceText, withHintText } from '@fugloy/disasm';
import type { Row } from '@fugloy/disasm';
import { detailsText, explainAt, explainRowAt, pictureBytes, PICTURE_MAX, summaryAt, warmExplain } from '../app/utils/explain-view';

const ex = (p: string): string => fileURLToPath(new URL(`../../../examples/${p}`, import.meta.url));
const open = () =>
  withHintText(
    openProgram(new Uint8Array(readFileSync(ex('sea-dragon/seadrg01.cmd'))), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
    readFileSync(ex('sea-dragon/seadrg01.hints'), 'utf8'),
    'seadrg01.hints',
  );

describe('explain-view cache', () => {
  it('returns the same explanation for the same session and address, and a new one after the session changes', () => {
    const s = open();
    const e = explainAt(s, 0x49a7);
    expect(e.sentences.map(sentenceText).join(' ')).toContain('row 14');
    expect(explainAt(s, 0x49a7)).toBe(e);
    expect(explainAt(s, 0x49ab)).not.toBe(e);
    const s2 = withHintText(s, readFileSync(ex('sea-dragon/seadrg01.hints'), 'utf8'), 'seadrg01.hints');
    expect(s2).not.toBe(s);
    const e2 = explainAt(s2, 0x49a7);
    expect(e2).not.toBe(e);
    expect(explainAt(s2, 0x49a7)).toBe(e2);
  });

  it('explains a row through the same cache for code, and by its own kind for a note', () => {
    const s = open();
    const code: Row = { kind: 'code', addr: 0x49a7, bytes: [], spans: [] } as unknown as Row;
    expect(explainRowAt(s, code)).toBe(explainAt(s, 0x49a7));
    const note: Row = { kind: 'note', addr: 0x497f, text: '; relocated: file $5200-$8880 executes at $497F-$7FFF' };
    const n = explainRowAt(s, note);
    expect(n.kind).toBe('other');
    expect(explainRowAt(s, note)).toBe(n);
  });

  it('caches routine summaries per session and routine start', () => {
    const s = open();
    const r = summaryAt(s, 0x49a7);
    expect(r?.name).toBe('L497F');
    expect(summaryAt(s, 0x49ab)).toBe(r);
    expect(summaryAt(s, 0x7dd5)).toBeNull();
  });

  it('warms the routine index off the keypress path, and can be cancelled', async () => {
    const s = open();
    let ran = false;
    const cancel = warmExplain(s, 0x8881, () => (ran = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(ran).toBe(true);
    let never = false;
    warmExplain(s, 0x8881, () => (never = true))();
    cancel();
    await new Promise((r) => setTimeout(r, 50));
    expect(never).toBe(false);
  });
});

describe('explain-view helpers', () => {
  it('words the details strip: size, T-states (both when conditional), flags, documented', () => {
    expect(detailsText({ bytes: 4, cycles: 14, flags: '', documented: true })).toBe('4 bytes · 14 T-states · flags unchanged');
    expect(detailsText({ bytes: 2, cycles: 21, cyclesNotTaken: 16, flags: 'HPN', documented: true })).toBe('2 bytes · 21 or 16 T-states · changes H P N');
    expect(detailsText({ bytes: 1, cycles: 4, flags: 'SZHPNC', documented: false })).toBe('1 byte · 4 T-states · changes S Z H P N C · undocumented');
  });

  it('reads a region picture from the runtime image, at most 16K', () => {
    const s = open();
    const b = pictureBytes(s, { start: 0x7399, end: 0x7fff });
    expect(b.length).toBe(0x7fff - 0x7399 + 1);
    expect(b[0]).toBe(s.analysis.space.image.bytes[0x7399]);
    expect(pictureBytes(s, { start: 0x4000, end: 0xffff }).length).toBe(PICTURE_MAX);
  });
});
