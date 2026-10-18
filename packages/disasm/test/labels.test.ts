import { describe, expect, it } from 'vitest';
import { emptyAnnotations } from '../src/hints/apply.js';
import { writeHints } from '../src/hints/format.js';
import { programHash } from '../src/hints/identity.js';
import { decodeRle, parseLabelFile } from '../src/labels/format.js';
import type { LabelFile } from '../src/labels/format.js';
import { labelAnnotations, mergeAnnotations } from '../src/labels/apply.js';
import { analysisSpace } from '../src/analysis/relocate.js';
import { openProgram, OpenError, renderSession, skeletonHints, withHintText, withLabelFile } from '../src/session.js';
import { sampleCmd, sampleLabelText } from './label-sample.js';

const bytes = sampleCmd();
const hash = programHash(bytes);
const parsed = (): LabelFile => {
  const { file, errors } = parseLabelFile(sampleLabelText());
  expect(errors).toEqual([]);
  return file!;
};
/** The fixture with `edit` applied to its JSON object. */
const edited = (edit: (o: Record<string, any>) => void): string => {
  const o = JSON.parse(sampleLabelText()) as Record<string, any>;
  edit(o);
  return JSON.stringify(o);
};
const open = () => openProgram(bytes, { name: 'sample.cmd' });
/** An rle-hex field with exactly `addrs` set. */
const rle = (addrs: number[]): string => {
  const bits = new Uint8Array(0x10000);
  for (const a of addrs) bits[a] = 1;
  const runs: number[] = [];
  let state = 0;
  let run = 0;
  for (const b of bits) {
    if (b === state) run++;
    else { runs.push(run); state = b; run = 1; }
  }
  runs.push(run);
  return runs.map((n) => n.toString(16).toUpperCase()).join(',');
};
const range = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + i);
const EXEC = [0x7000, 0x7001, 0x7004, 0x7006, 0x7009, 0x700b, 0x700c, 0x700f, 0x7012, 0x7015, 0x7018, 0x7020, 0x7023, 0x7024, 0x7030, 0x7034];

describe('the label file in the disassembler', () => {
  it('parses the shared fixture', () => {
    const file = parsed();
    expect(file.fugloy).toBe(1);
    expect(file.program).toEqual({ name: 'SAMPLE', sha256: hash, model: 3 });
    expect(file.load.map((l) => [l.addr, l.len])).toEqual([[0x7000, 64], [0x7040, 2]]);
    expect(file.entry).toBe(0x7000);
    expect(file.labels.map((l) => l.name)).toEqual(['ENTRY', 'SUB_7020', 'SUB_7030', 'BUMP', 'SCORE']);
    expect(Object.keys(file.coverage)).toEqual(['0:0']);
    const exec = decodeRle(file.coverage['0:0']!.exec)!;
    expect(exec.length).toBe(0x10000);
    expect([...exec.keys()].filter((a) => exec[a] === 1)).toEqual([0x0008, ...EXEC]);
  });

  it('reports a broken file', () => {
    const errorsOf = (text: string): string[] => {
      const r = parseLabelFile(text);
      expect(r.file).toBeNull();
      return r.errors;
    };
    expect(errorsOf('{ not json')[0]).toMatch(/^not JSON: /);
    expect(errorsOf('[]')).toEqual(['the label file is not a JSON object']);
    expect(errorsOf(edited((o) => { o['fugloy'] = 2; }))).toEqual(['fugloy is format version 2; this reader knows version 1']);
    expect(errorsOf(edited((o) => { delete o['sessions']; }))).toEqual(['the key "sessions" is missing']);
    expect(errorsOf(edited((o) => { o['program'].sha256 = 'ABC'; }))).toEqual(['program.sha256 must be 64 lowercase hex digits']);
    expect(errorsOf(edited((o) => { o['labels'][1].kind = 'subroutine'; }))).toEqual(['labels[1].kind must be "code" or "data"']);
    expect(errorsOf(edited((o) => { delete o['labels'][1].evidence; }))).toEqual(['labels[1] is observed and has no evidence']);
    expect(errorsOf(edited((o) => { o['labels'][4].addr = 0x7034; }))).toEqual(['labels[4]: $7034 already has a label']);
    expect(errorsOf(edited((o) => { o['coverage']['0:0'].read = '7040,,1,EBD,2,8100'; }))).toEqual(['coverage["0:0"].read: run 2 is empty']);
    expect(errorsOf(edited((o) => { o['coverage']['0:0'].write = '7041,1,EBC,2,80FF'; }))).toEqual(['coverage["0:0"].write: the runs sum to $FFFF, not $10000']);
    expect(errorsOf(edited((o) => { o['coverage']['0:0'].jump = '7006,1,2D,1,8FCBG'; }))).toEqual(['coverage["0:0"].jump: run 5 "8FCBG" is not one to five hex digits']);
    // A control character in a name or evidence would start a new line in the listing or the zmac source.
    expect(errorsOf(edited((o) => { o['labels'][1].evidence = 'called 3×\n        JP 0'; }))).toEqual(['labels[1].evidence contains a control character']);
    expect(errorsOf(edited((o) => { o['labels'][3].name = 'BU\rMP'; }))).toEqual(['labels[3].name contains a control character']);
    expect(errorsOf(edited((o) => { o['labels'][3].name = 'BUMP\u007f'; o['labels'][2].evidence = '\u0000'; }))).toEqual([
      'labels[2].evidence contains a control character',
      'labels[3].name contains a control character',
    ]);
    expect(errorsOf(edited((o) => { o['labels'][1].evidence = ''; }))).toEqual(['labels[1] is observed and has no evidence']);
    // Duplicates are keyed by map, page, and address (map and page default to 0), as the emulator's reader keys them.
    expect(errorsOf(edited((o) => { Object.assign(o['labels'][4], { addr: 0x7034, map: 0 }); }))).toEqual(['labels[4]: $7034 already has a label']);
    expect(errorsOf(edited((o) => { Object.assign(o['labels'][4], { addr: 0x7034, page: 1 }); o['labels'][3].page = 1; }))).toEqual(['labels[4]: $7034 (map 0, page 1) already has a label']);
    expect(parseLabelFile(edited((o) => { Object.assign(o['labels'][4], { addr: 0x7034, page: 1 }); })).errors).toEqual([]);
    expect(errorsOf(edited((o) => { o['labels'][4].map = -1; }))).toEqual(['labels[4].map must be a non-negative integer']);
    // A note, on a label of any source, is a string with no control character.
    expect(parseLabelFile(edited((o) => { o['labels'][1].note = 'a delay?'; o['labels'][3].note = 'adds one'; })).errors).toEqual([]);
    expect(errorsOf(edited((o) => { o['labels'][3].note = 5; }))).toEqual(['labels[3].note must be a string']);
    expect(errorsOf(edited((o) => { o['labels'][3].note = 'adds\none'; }))).toEqual(['labels[3].note contains a control character']);
    // Either case, and zero-length runs anywhere, are fine.
    expect(parseLabelFile(edited((o) => { o['coverage']['0:0'].read = '0,0,7040,1,ebd,0,0,2,8100'; })).errors).toEqual([]);
  });

  it('exec bits become roots and read-only runs become nocode', () => {
    const { annotations, summary, refused } = labelAnnotations(parsed(), open().module.image, hash);
    expect(refused).toBeNull();
    // The ROM's RET at $0008 ran, but nothing is loaded there.
    expect(annotations.entries).toEqual(EXEC);
    expect(annotations.executed).toEqual(EXEC.filter((a) => ![0x7000, 0x7020, 0x7030, 0x7034].includes(a)));
    expect(annotations.overrides).toEqual([
      { addr: 0x7040, kind: 'bytes', length: 2 },
      { addr: 0x7040, kind: 'nocode', length: 1, fromLabels: true },
    ]);
    expect(summary).toEqual({ names: 3, roots: 16, dataRuns: 1, warnings: [] });
    // Another coverage key is reported and ignored.
    const paged = parseLabelFile(edited((o) => { o['coverage']['2:1'] = o['coverage']['0:0']; })).file!;
    expect(labelAnnotations(paged, open().module.image, hash).summary.warnings).toEqual(['coverage for map 2, page 1 is ignored; only "0:0" applies to this machine']);
  });

  it('generated-shape names are roots without names', () => {
    const { annotations } = labelAnnotations(parsed(), open().module.image, hash);
    expect([...annotations.names]).toEqual([[0x7000, 'ENTRY'], [0x7034, 'BUMP'], [0x7040, 'SCORE']]);
    expect(annotations.entries).toContain(0x7020);
    expect(annotations.entries).toContain(0x7030);
    const listing = renderSession(withLabelFile(open(), parsed(), 'sample.labels.json'), 'listing');
    expect(listing).toContain('; labels: sample.labels.json: 3 names, 16 roots, 1 data run applied\n');
    expect(listing).toMatch(/^SUB_7020:/m);
    // Only the entry and the code labels are marked entry; an instruction that merely ran is a root without the mark.
    expect(listing).toMatch(/^7000 .*DI +; entry$/m);
    expect(listing).toMatch(/^7001 .*LD SP,7F00H$/m);
    expect(listing).toMatch(/^BUMP:/m);
  });

  it('observed evidence becomes a comment', () => {
    const { annotations } = labelAnnotations(parsed(), open().module.image, hash);
    expect([...annotations.comments]).toEqual([[0x7020, 'observed: called 3× from 1 site'], [0x7030, 'observed: called 2× from 2 sites']]);
    expect(renderSession(withLabelFile(open(), parsed()), 'listing')).toContain('; observed: called 2× from 2 sites');
  });

  it('a note becomes the comment, ahead of any evidence, and a hint comment wins', () => {
    const noted = parseLabelFile(edited((o) => {
      o['labels'][3].note = 'adds one to the score';
      o['labels'][2].note = 'the tick';
    })).file!;
    const { annotations } = labelAnnotations(noted, open().module.image, hash);
    expect(annotations.comments.get(0x7034)).toBe('adds one to the score');
    expect(annotations.comments.get(0x7030)).toBe('the tick; observed: called 2× from 2 sites');
    expect(renderSession(withLabelFile(open(), noted), 'listing')).toContain('; adds one to the score');
    const s = open();
    const hints = `${writeHints(skeletonHints(s.module, bytes))}block 0:$0034 comment bumps it\n`;
    expect(withLabelFile(withHintText(s, hints, 'sample.hints'), noted).analysis.annotations.comments.get(0x7034)).toBe('bumps it');
  });

  it('hint names win over label names', () => {
    const s = open();
    const hints = `${writeHints(skeletonHints(s.module, bytes))}block 0:$0034 name TICK\nblock 0:$0020 comment loads the score\nblock 0:$0040 words 2\n`;
    const both = withLabelFile(withHintText(s, hints, 'sample.hints'), parsed(), 'sample.labels.json');
    const { names, comments, overrides } = both.analysis.annotations;
    expect(names.get(0x7034)).toBe('TICK');
    expect(names.get(0x7000)).toBe('ENTRY');
    expect(comments.get(0x7020)).toBe('loads the score');
    // The hint's words cover $7040-$7041, so the label file's bytes and nocode there are dropped.
    expect(overrides.filter((o) => o.addr === 0x7040)).toEqual([{ addr: 0x7040, kind: 'words', length: 2 }]);
    expect(both.analysis.labels).toEqual({ source: 'sample.labels.json', names: 2, roots: 16, dataRuns: 0, warnings: [] });
    // Applying the hints after the label file gives the same result.
    const other = withHintText(withLabelFile(s, parsed(), 'sample.labels.json'), hints, 'sample.hints');
    expect(renderSession(other, 'listing')).toBe(renderSession(both, 'listing'));
    // mergeAnnotations on its own: entries unioned, the hint's name and comment kept.
    const h = emptyAnnotations();
    h.entries.push(0x7006);
    h.names.set(0x7000, 'START');
    h.overrides.push({ addr: 0x7030, kind: 'code', length: 0 });
    const l = emptyAnnotations();
    l.entries.push(0x7000, 0x7006);
    l.names.set(0x7000, 'ENTRY');
    l.names.set(0x7034, 'START');
    l.overrides.push({ addr: 0x7030, kind: 'nocode', length: 1 }, { addr: 0x7040, kind: 'nocode', length: 1 });
    const m = mergeAnnotations(h, l);
    expect(m.entries).toEqual([0x7006, 0x7000]);
    // A label name the hints already use elsewhere is dropped too: zmac would see it twice.
    expect([...m.names]).toEqual([[0x7000, 'START']]);
    expect(m.overrides).toEqual([{ addr: 0x7030, kind: 'code', length: 0 }, { addr: 0x7040, kind: 'nocode', length: 1 }]);
  });

  it('an executed address that is an entry for another reason keeps its entry mark', () => {
    const s = withLabelFile(openProgram(bytes, { name: 'sample.cmd', entries: [0x7004] }), parsed());
    const listing = renderSession(s, 'listing');
    expect(listing).toMatch(/^7004 .*LD B,03H +; entry$/m);
    expect(listing).toMatch(/^7000 .*DI +; entry$/m);
    expect(listing).toMatch(/^7006 .*CALL SUB_7020$/m);
    expect(s.analysis.annotations.executed).not.toContain(0x7004);
    expect(s.analysis.annotations.executed).not.toContain(0x7000);
  });

  it('a path that lands inside a read-only run ends there', () => {
    // Coverage that saw $7033-$7035 read and nothing executed: static descent still reaches JP 7034H, which lands inside the run.
    const file = parseLabelFile(edited((o) => {
      o['labels'] = [];
      o['coverage']['0:0'] = { encoding: 'rle-hex', exec: '10000', operand: '10000', read: '7033,3,8FCA', write: '10000', jump: '10000', call: '10000' };
    })).file!;
    const s = withLabelFile(open(), file);
    expect(s.analysis.annotations.overrides).toEqual([{ addr: 0x7033, kind: 'nocode', length: 3, fromLabels: true }]);
    expect(s.analysis.pass1.diagnostics.map((d) => d.message)).toContain('path ends at $7034 (read, never executed, per the label file)');
    expect(s.analysis.pass1.instructions.has(0x7034)).toBe(false);
    expect(s.analysis.pass1.instructions.has(0x7030)).toBe(true);
  });

  it('a root from another source inside a read-only run decodes: the run stops short of it', () => {
    // $7033-$7035 read and never run, as above; a hint entry at $7033 and --entry $7034 are stronger.
    const file = parseLabelFile(edited((o) => {
      o['labels'] = [];
      o['coverage']['0:0'] = { encoding: 'rle-hex', exec: '10000', operand: '10000', read: '7033,3,8FCA', write: '10000', jump: '10000', call: '10000' };
    })).file!;
    const s = open();
    const hinted = withLabelFile(withHintText(s, `${writeHints(skeletonHints(s.module, bytes))}block 0:$0033 entry\n`), file);
    expect(hinted.analysis.pass1.instructions.has(0x7033)).toBe(true);
    expect(hinted.analysis.pass1.instructions.has(0x7034)).toBe(true);
    expect(hinted.analysis.pass1.diagnostics.filter((d) => d.kind === 'nocode')).toEqual([]);
    const entered = withLabelFile(openProgram(bytes, { name: 'sample.cmd', entries: [0x7034] }), file);
    expect(entered.analysis.pass1.instructions.has(0x7034)).toBe(true);
    expect(entered.analysis.pass1.diagnostics.filter((d) => d.kind === 'nocode')).toEqual([]);
  });

  it('a written byte is never applied as data, and code that changed at runtime is skipped with one warning', () => {
    // The sample's coverage, with $7006-$7008 (CALL 7020H, executed) and the code label BUMP at $7034 written, and $7040 (read) written.
    const file = parseLabelFile(edited((o) => { o['coverage']['0:0'].write = rle([0x7007, 0x7034, 0x7040, 0x7041]); })).file!;
    const { annotations, summary } = labelAnnotations(file, open().module.image, hash);
    expect(annotations.entries).not.toContain(0x7006);
    expect(annotations.entries).not.toContain(0x7034);
    expect(annotations.names.has(0x7034)).toBe(false);
    // The data label SCORE stays (data is what a program writes); its read-only run does not, being written.
    expect(annotations.names.get(0x7040)).toBe('SCORE');
    expect(annotations.overrides).toEqual([{ addr: 0x7040, kind: 'bytes', length: 2 }]);
    expect(annotations.changed).toEqual([{ addr: 0x7007, length: 1 }, { addr: 0x7034, length: 1 }, { addr: 0x7040, length: 2 }]);
    expect(summary.warnings).toEqual(["2 executed or labelled addresses changed at runtime (written while coverage was on, or since the load); their coverage is not applied to the file's bytes (a relocate hint says where moved code runs)"]);
    // The module's entry is not the label file's: its path still decodes the changed bytes, which are the file's own.
    const s = withLabelFile(open(), file);
    expect(s.analysis.pass1.instructions.has(0x7006)).toBe(true);
    expect(s.analysis.pass1.instructions.has(0x7034)).toBe(true);
  });

  it('a label for another map or page is skipped', () => {
    const file = parseLabelFile(edited((o) => { o['labels'][3].page = 2; })).file!;
    const { annotations, summary } = labelAnnotations(file, open().module.image, hash);
    expect(annotations.names.has(0x7034)).toBe(false);
    expect(summary.warnings).toEqual(['label BUMP at $7034 is for map 0, page 2; only map 0, page 0 applies to this machine; skipped']);
  });

  it('refuses a file written for another program', () => {
    const other = parseLabelFile(edited((o) => { o['program'].sha256 = '0'.repeat(64); })).file!;
    const r = labelAnnotations(other, open().module.image, hash);
    expect(r.refused).toBe(`the label file was written for another program (its sha256 is ${'0'.repeat(64)}, this program's is ${hash}); nothing applied`);
    expect(r.annotations).toEqual(emptyAnnotations());
    expect(() => withLabelFile(open(), other)).toThrow(OpenError);
    try {
      withLabelFile(open(), other);
    } catch (e) {
      expect((e as OpenError).kind).toBe('labels');
      expect((e as OpenError).message).toBe(r.refused);
    }
  });

  it('a file without sha256 applies', () => {
    const file = parseLabelFile(edited((o) => { delete o['program'].sha256; })).file!;
    expect(file.program.sha256).toBeUndefined();
    const s = withLabelFile(open(), file);
    expect(s.analysis.labels).toEqual({ names: 3, roots: 16, dataRuns: 1, warnings: [] });
    expect(s.analysis.roots).toEqual(EXEC);
    const ir = JSON.parse(renderSession(s, 'ir')) as { labels: { names: number } };
    expect(ir.labels.names).toBe(3);
  });

  it('applies label addresses as runtime addresses under a relocate hint', () => {
    const s = open();
    // $7030-$7034 runs at $8000-$8004.
    const hints = `${writeHints(skeletonHints(s.module, bytes))}block 0:$0030 relocate $8000 $0005\n`;
    const file = parseLabelFile(edited((o) => {
      delete o['program'].sha256;
      o['labels'] = [{ addr: 0x8004, name: 'MOVED', kind: 'code', source: 'user' }, { addr: 0x7034, name: 'BUMP', kind: 'code', source: 'user' }];
    })).file!;
    const both = withLabelFile(withHintText(s, hints), file);
    expect(both.analysis.annotations.names.get(0x8004)).toBe('MOVED');
    expect(both.analysis.annotations.names.has(0x7034)).toBe(false);
    expect(both.analysis.labels?.warnings).toContain('label BUMP at $7034 is outside loaded memory; skipped');
  });

  it('inside a relocation, executed code applies even where it was written; outside one it does not', () => {
    const s = open();
    const hints = `${writeHints(skeletonHints(s.module, bytes))}block 0:$0030 relocate $8000 $0005\n`;
    // The copy wrote $8000-$8004, and the moved JP ran at $8000; $7001-$7003 (LD SP, executed) changed too.
    const file = parseLabelFile(edited((o) => {
      delete o['program'].sha256;
      o['labels'] = [];
      Object.assign(o['coverage']['0:0'], { exec: rle([0x7000, 0x7001, 0x8000]), operand: rle([0x7002, 0x7003, 0x8001, 0x8002]), read: '10000', write: rle([...range(0x7001, 3), ...range(0x8000, 5)]) });
    })).file!;
    const { space } = analysisSpace(s.module.image, [{ fileAddr: 0x7030, length: 5, runAddr: 0x8000 }]);
    const { annotations, summary } = labelAnnotations(file, space.image, '', space.relocations);
    expect(annotations.entries).toEqual([0x7000, 0x8000]);
    expect(annotations.changed).toEqual([{ addr: 0x7001, length: 3 }]);
    expect(summary.warnings).toHaveLength(1);
    expect(withLabelFile(withHintText(s, hints), file).analysis.pass1.instructions.has(0x8000)).toBe(true);
  });
});
