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
