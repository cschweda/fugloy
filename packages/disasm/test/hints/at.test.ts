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
