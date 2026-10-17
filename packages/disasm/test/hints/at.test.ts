import { describe, expect, it } from 'vitest';
import { parseHints, writeHints } from '../../src/hints/format.js';
import { openProgram, renderSession, withHintText } from '../../src/session.js';

const HEAD = 'fugloy-hints 1\n';
const raw = () => openProgram(Uint8Array.from([0x3a, 0x00, 0x7f, 0xc9]), { base: 0x7000, entries: [0x7000], name: 'at.bin' });

describe('the at directive', () => {
  it('parses a name and a comment keyed by address', () => {
    const { file, errors } = parseHints(`${HEAD}at $7F00 name SCORE\nat 7F01H comment lives here\n`);
    expect(errors).toEqual([]);
    expect(file.hints).toMatchObject([
      { directive: 'name', at: 0x7f00, name: 'SCORE', block: -1, offset: -1 },
      { directive: 'comment', at: 0x7f01, text: 'lives here', block: -1, offset: -1 },
    ]);
  });

  it('writes what it parsed', () => {
    const text = `${HEAD}at $7F00 name SCORE\nat $7F01 comment lives here\n`;
    const out = writeHints(parseHints(text).file);
    expect(out).toContain('at $7F00 name SCORE\nat $7F01 comment lives here\n');
    expect(parseHints(out).file.hints).toMatchObject(parseHints(text).file.hints.map(({ line: _l, ...h }) => h));
  });

  it('rejects a reserved name, a bad address, and a repeated name', () => {
    expect(parseHints(`${HEAD}at $7F00 name LD\n`).errors).toEqual([{ line: 2, message: 'name "LD" is reserved' }]);
    expect(parseHints(`${HEAD}at zzz name X\n`).errors[0]!.message).toBe('bad number "zzz"');
    expect(parseHints(`${HEAD}at $7F00 name SCORE\nat $7F01 name score\n`).errors[0]!.message).toContain('already used');
    expect(parseHints(`${HEAD}at $7F00 frob\n`).errors[0]!.message).toBe('unknown directive "frob"');
  });

  it('names an operand outside the image in the listing, the header, the zmac source, and the IR', () => {
    const s = withHintText(raw(), `${HEAD}at $7F00 name SCORE\nat $7F00 comment player score\n`);
    const listing = renderSession(s, 'listing');
    expect(listing).toContain('LD A,(SCORE)');
    expect(listing).toContain('; name SCORE = $7F00: player score\n');
    expect(renderSession(s, 'zmac')).toContain('SCORE\tEQU\t7F00H\t; player score\n');
    const ir = JSON.parse(renderSession(s, 'ir')) as { symbols: { name: string; comment?: string }[] };
    expect(ir.symbols).toMatchObject([{ name: 'SCORE', comment: 'player score' }]);
  });

  it('omits the comment parts when there is none', () => {
    const s = withHintText(raw(), `${HEAD}at $7F00 name SCORE\n`);
    expect(renderSession(s, 'listing')).toContain('; name SCORE = $7F00\n');
    expect(renderSession(s, 'zmac')).toContain('SCORE\tEQU\t7F00H\n');
  });

  it('does not apply an at hint on a loaded address, and warns', () => {
    const s = withHintText(raw(), `${HEAD}at $7000 name START\n`);
    expect(s.applied.annotations.names.size).toBe(0);
    expect(s.applied.warnings).toEqual(['at $7000 names a loaded address; use block 0:$0000 instead']);
    expect(renderSession(s, 'listing')).not.toContain('START');
  });
});

describe('the at directive: comments without names, and refusals', () => {
  it('shows a comment with no name in the header, the zmac source, and the IR', () => {
    const s = withHintText(raw(), `${HEAD}at $7F01 comment lives\nat $7F00 name SCORE\n`);
    const listing = renderSession(s, 'listing');
    expect(listing).toContain('; name SCORE = $7F00\n; comment $7F01: lives\n');
    const zmac = renderSession(s, 'zmac');
    expect(zmac).toContain('SCORE\tEQU\t7F00H\n; 7F01H: lives\n');
    const ir = JSON.parse(renderSession(s, 'ir')) as { outsideComments?: unknown };
    expect(ir.outsideComments).toEqual([{ addr: 0x7f01, text: 'lives' }]);
  });

  it('leaves the IR without outsideComments when there are none', () => {
    const ir = JSON.parse(renderSession(withHintText(raw(), `${HEAD}at $7F00 name SCORE\n`), 'ir')) as Record<string, unknown>;
    expect('outsideComments' in ir).toBe(false);
  });

  it('does not count a rejected at hint as applied', () => {
    const s = withHintText(raw(), `${HEAD}at $7000 name START\nat $7F00 name SCORE\n`);
    expect(s.analysis.hints?.applied).toBe(1);
  });

  it('rejects an empty at comment', () => {
    expect(parseHints(`${HEAD}at $7F00 comment\n`).errors).toEqual([{ line: 2, message: 'comment needs text' }]);
  });

  it('rejects a generated-label shape and a name a block hint already uses', () => {
    expect(parseHints(`${HEAD}at $7F00 name L7000\n`).errors[0]!.message).toContain('generated label');
    const text = `${HEAD}block 0 length $0004 hash 0123456789abcdef\nblock 0:$0000 name SCORE\nat $7F00 name score\n`;
    expect(parseHints(text).errors).toEqual([{ line: 4, message: 'name "score" is already used at 0:$0000' }]);
  });
});
