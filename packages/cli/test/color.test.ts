import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyze, dbItems, formatListingLine, loadCmd, loadRaw, renderPass1Listing } from '@fugloy/disasm';
import type { ListingLine } from '@fugloy/disasm';
import { colorListing } from '../src/color.js';

const paint = (sgr: string, text: string): string => `\x1b[${sgr}m${text}\x1b[0m`;
// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
const row = (addr: number, bytes: number[], text: string, comment?: string): string =>
  formatListingLine({ addr, bytes, text } as ListingLine, comment);
const fixtures = fileURLToPath(new URL('../../../fixtures/synthetic/', import.meta.url));

describe('colorListing', () => {
  it('colors the address, bytes, mnemonic, register, number, and comment of an instruction row', () => {
    const line = row(0x5200, [0x31, 0x27, 0x6f], 'LD SP,6F27H', 'entry');
    const colored = colorListing(line);
    expect(plain(colored)).toBe(line);
    expect(colored.startsWith(`${paint('36', '5200')}  ${paint('2', '31 27 6F')}`)).toBe(true);
    expect(colored).toContain(`${paint('94', 'LD')} ${paint('32', 'SP')},${paint('33', '6F27H')}`);
    expect(colored.endsWith(paint('90', '; entry'))).toBe(true);
  });

  it('colors symbols, conditions, and the alternate register pair', () => {
    expect(colorListing(row(0x4a15, [0xf2, 0x21, 0x4a], 'JP P,L4A21'))).toContain(`${paint('94', 'JP')} ${paint('32', 'P')},${paint('96', 'L4A21')}`);
    expect(colorListing(row(0x0100, [0x08], "EX AF,AF'"))).toContain(`${paint('32', 'AF')},${paint('32', "AF'")}`);
  });

  it('colors a DB string whole, as the emitter quotes it, with a semicolon and a quote inside', () => {
    const bytes = [0x48, 0x49, 0x3b, 0x27]; // HI;'
    const text = `DB ${dbItems(bytes)}`; // DB 'HI;'''
    const colored = colorListing(row(0x81e5, bytes, text, 'entry'));
    expect(colored).toContain(`${paint('35', 'DB')} ${paint('31', "'HI;'''")}`);
    expect(colored.endsWith(paint('90', '; entry'))).toBe(true);
  });

  it('colors a table name as one token, with its leading $ or @ and its trailing $', () => {
    const cases: [string, number[], string, string][] = [
      ['CALL $KBWAIT', [0xcd, 0x49, 0x00], `${paint('94', 'CALL')} ${paint('96', '$KBWAIT')}`, 'a ROM routine'],
      ['JP @EXIT', [0xc3, 0x2d, 0x40], `${paint('94', 'JP')} ${paint('96', '@EXIT')}`, 'a DOS routine'],
      ['LD HL,(TIME$)', [0x2a, 0x00, 0x43], `${paint('32', 'HL')},(${paint('96', 'TIME$')})`, 'a name that ends in $'],
      ['LD HL,(@HIGH$)', [0x2a, 0x00, 0x43], `${paint('32', 'HL')},(${paint('96', '@HIGH$')})`, 'a name that starts with @ and ends in $'],
      ['LD HL,@HIGH$+0001H', [0x21, 0x01, 0x43], `${paint('32', 'HL')},${paint('96', '@HIGH$')}+${paint('33', '0001H')}`, 'a sigil name with an offset'],
      ['LD A,($KIDCB)', [0x3a, 0x00, 0x40], `${paint('32', 'A')},(${paint('96', '$KIDCB')})`, 'a memory operand'],
    ];
    for (const [text, bytes, expected, what] of cases) {
      const line = row(0x5200, bytes, text, 'entry');
      const colored = colorListing(line);
      expect(colored, what).toContain(expected);
      expect(plain(colored), what).toBe(line);
    }
  });

  it('colors a plain name as before, and leaves a $ or @ that opens no name plain', () => {
    expect(colorListing(row(0x5200, [0x21, 0x40, 0x3d], 'LD HL,VIDEO+0140H'))).toContain(`${paint('32', 'HL')},${paint('96', 'VIDEO')}+${paint('33', '0140H')}`);
    expect(colorListing(row(0x5200, [0xcd, 0x0a, 0x4a], 'CALL SUB_4A0A'))).toContain(`${paint('94', 'CALL')} ${paint('96', 'SUB_4A0A')}`);
    // A lone $ or @ is no name, and a $ before digits opens none: operands print hex as 3C00H, so this is not a form the listing writes.
    expect(colorListing(row(0x5200, [0xc9], 'RET $ @'))).toContain(`${paint('94', 'RET')} $ @`);
    expect(colorListing(row(0x5200, [0x21, 0x00, 0x3c], 'LD HL,$3C00'))).toContain(`${paint('32', 'HL')},$${paint('33', '3C00')}`);
  });

  it('paints a $-hex address in a comment or a prose line as part of the comment, never as a name', () => {
    expect(colorListing('; symbol FOO = $3C00 (in line 10)')).toBe(paint('90', '; symbol FOO = $3C00 (in line 10)'));
    expect(colorListing('; table name $KBWAIT = $0049: wait for a key (m3-basic 12/12)')).toBe(paint('90', '; table name $KBWAIT = $0049: wait for a key (m3-basic 12/12)'));
    const line = row(0x5200, [0x21, 0x00, 0x3c], 'LD HL,VIDEO', 'video is $3C00, same as $KBWAIT');
    const colored = colorListing(line);
    expect(colored.endsWith(paint('90', '; video is $3C00, same as $KBWAIT'))).toBe(true);
    expect(plain(colored)).toBe(line);
    // a BASIC note line is a comment too
    expect(colorListing(';   16526 = $408E USR vector (USRVEC+1)')).toBe(paint('90', ';   16526 = $408E USR vector (USRVEC+1)'));
  });

  it("keeps the alternate register's apostrophe from opening a string", () => {
    const colored = colorListing(row(0x0100, [0x08], "EX AF,AF'", 'entry'));
    expect(colored).toContain(`${paint('32', 'AF')},${paint('32', "AF'")}`);
    expect(colored.endsWith(paint('90', '; entry'))).toBe(true);
  });

  it('colors the strings the heuristic types in a real pass 1 listing', () => {
    const listing = renderPass1Listing(analyze(loadRaw(Uint8Array.from([0xc9, ...Array.from('HELLO WORLD', (ch) => ch.charCodeAt(0)), 0x0d]), 0x6000)));
    expect(listing).toContain("DB 'HELL'");
    expect(colorListing(listing)).toContain(paint('31', "'HELL'"));
  });

  it('colors header comments, warnings, labels, directives, and BASIC line numbers', () => {
    expect(colorListing('; pass 1: roots $5200')).toBe(paint('90', '; pass 1: roots $5200'));
    expect(colorListing('; warning: 3 bytes after the transfer record ignored')).toBe(paint('33', '; warning: 3 bytes after the transfer record ignored'));
    expect(colorListing('SUB_4A0A:')).toBe(paint('96', 'SUB_4A0A:'));
    expect(colorListing('        ORG 5200H')).toBe(`        ${paint('35', 'ORG')} ${paint('33', '5200H')}`);
    expect(colorListing('10 CLS:PRINT"HI"')).toBe(`${paint('36', '10')} CLS:PRINT"HI"`);
    expect(colorListing('20 [unparsed: 4 bytes at $6A50: unexpected + at +0]')).toBe(`${paint('36', '20')} ${paint('31', '[unparsed: 4 bytes at $6A50: unexpected + at +0]')}`);
  });

  it('adds escape codes and never changes a character of a real listing', () => {
    const listing = renderPass1Listing(analyze(loadCmd(new Uint8Array(readFileSync(`${fixtures}cmd/hint-paths.cmd`)))), { source: 'hint-paths.cmd' });
    const colored = colorListing(listing);
    expect(colored).not.toBe(listing);
    expect(plain(colored)).toBe(listing);
  });
});
