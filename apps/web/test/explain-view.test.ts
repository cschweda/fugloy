// The Explain tab's cache and helpers (app/utils/explain-view.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProgram, sentenceText, withHintText } from '@fugloy/disasm';
import type { Row } from '@fugloy/disasm';
import { detailsText, explainAt, explainRowAt, labelSentences, patternSentences, pictureBytes, PICTURE_MAX, summaryAt, summaryParts, thinLinks, warmExplain } from '../app/utils/explain-view';

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
    // The same array for the same region, so stepping through its rows does not redraw the picture.
    expect(pictureBytes(s, { start: 0x7399, end: 0x7fff })).toBe(b);
  });

  it('links an address once when adjacent pieces link it again ("$5200 (L5200)")', () => {
    const s = open();
    const lead = explainAt(s, 0x888b).sentences[0]!;
    const thin = thinLinks(lead);
    expect(sentenceText(thin)).toBe(sentenceText(lead));
    expect(lead.filter((p) => p.addr !== undefined).length).toBe(4);
    expect(thin.filter((p) => p.addr !== undefined).map((p) => p.text)).toEqual(['$5200', '$497F']);
    // Different addresses, or the same one after other words, stay links.
    expect(thinLinks([{ text: 'A', addr: 1 }, { text: ' and ' }, { text: 'B', addr: 1 }]).filter((p) => p.addr !== undefined).length).toBe(2);
    const plain = [{ text: 'no links' }];
    expect(thinLinks(plain)).toBe(plain);
  });

  it('on the copy pattern\'s own LDIR, shows only what the lead lacks; elsewhere in the span, the whole pattern', () => {
    const s = open();
    const ldir = explainAt(s, 0x888b);
    expect(patternSentences(ldir)!.map(sentenceText)).toEqual(['This moves the program to where it runs.']);
    const loop = explainAt(s, 0x49b1);
    expect(patternSentences(loop)).toBe(loop.pattern!.sentences);
    expect(patternSentences(explainAt(s, 0x49a7))).toBeNull();
  });

  it('splits a routine summary into its length, who reaches it and how it ends, and the rest', () => {
    const s = open();
    const { head, more } = summaryParts(summaryAt(s, 0x49a7)!);
    expect(head.map(sentenceText)).toEqual([
      'The routine L497F ($497F) is 53 instructions (139 bytes), counting the code it jumps to but not the routines it calls.',
      'This is an entry point the analysis starts from.',
      'It is jumped to from $4CC6, $602D, $6042 and $888D, and its address is used at $8885, so it may also be reached through a pointer.',
      'None of its paths returns or jumps out of it: it loops forever, unless a routine it calls leaves it.',
    ]);
    expect(more.length).toBe(summaryAt(s, 0x49a7)!.sentences.length - 4);
    expect(more.map(sentenceText)[0]).toContain('MODEPORT');
  });

  it('labelSentences: who jumps to or calls a label, as links, and whether it is the entry point', () => {
    const s = open();
    const at54b4 = labelSentences(s, explainAt(s, 0x54b4))!;
    expect(at54b4.map(sentenceText)).toEqual(['Jumped to from $54BC.']);
    expect(at54b4[0]!.find((p) => p.text === '$54BC')?.addr).toBe(0x54bc);
    const tone = labelSentences(s, explainAt(s, 0x6212))!.map(sentenceText);
    expect(tone[0]).toMatch(/^Called from \$[0-9A-F]{4}/);
    // 7000 NOP; 7001 JR 7000: the entry point is a label.
    const r = openProgram(new Uint8Array([0x00, 0x18, 0xfd]), { base: 0x7000 });
    expect(labelSentences(r, explainAt(r, 0x7000))!.map(sentenceText)).toEqual(['Jumped to from $7001.', 'This is where the program starts (its entry point).']);
    expect(labelSentences(s, explainAt(s, 0x49a7))).toBeNull();
  });

  it('labelSentences: a jump whose target bytes the program rewrites is not stated as a way in; a pointer to the label is', () => {
    // 7000 LD HL,7010H; 7003 LD A,20H; 7005 LD (700AH),A; 7008 NOP; 7009 JP 7010H (becomes JP 7020H); 700C-700F NOP; 7010 RET
    const s = openProgram(new Uint8Array([0x21, 0x10, 0x70, 0x3e, 0x20, 0x32, 0x0a, 0x70, 0x00, 0xc3, 0x10, 0x70, 0x00, 0x00, 0x00, 0x00, 0xc9]), { base: 0x7000 });
    const t = labelSentences(s, explainAt(s, 0x7010))!;
    const text = t.map(sentenceText);
    expect(text.join(' ')).not.toMatch(/Jumped to from \$7009/);
    expect(text.join(' ')).not.toMatch(/No call or jump to it was found/);
    expect(text).toContain('Its address is used at $7000, so it may be reached through a pointer.');
    expect(text).toContain('The jump at $7009 starts out leading here, but the program rewrites it as it runs, so it may lead elsewhere.');
    expect(t.flat().find((p) => p.text === '$7000')?.addr).toBe(0x7000);
    // A label with jumps that do arrive and a pointer: both.
    // 7000 LD HL,7006H; 7003 JP 7006H; 7006 RET
    const r = openProgram(new Uint8Array([0x21, 0x06, 0x70, 0xc3, 0x06, 0x70, 0xc9]), { base: 0x7000 });
    expect(labelSentences(r, explainAt(r, 0x7006))!.map(sentenceText)).toEqual(['Jumped to from $7003.', 'Its address is also used at $7000, so it may also be reached through a pointer.']);
  });
});
