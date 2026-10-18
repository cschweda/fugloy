/**
 * `label`: name an address (docs/fugloy-mcp-spec.md §5, Knowledge). The name is checked as the
 * disassembler checks a hint file's names (`nameProblem`), so every label the file carries is
 * one the listing can use; the sidecar is rewritten at once (Ruling 6).
 */
import { nameProblem } from '@fugloy/disasm';
import { z } from 'zod';
import { CONTROL, hex4, parseAddr, parseCount } from '../args.js';
import { writeSidecar } from '../sidecar.js';

/** Why each kind of name problem is one, for the refusal. */
const WHY = [
  [/is not an identifier$/, 'a name is a letter or _, then letters, digits, or _, up to 32 characters'],
  [/is reserved$/, 'a Z80 mnemonic, register, condition, or zmac word'],
  [/generated label$/, 'L, SUB_, DATA_, or TBL_ and four hex digits means no name was given'],
];

/** `code` or `data, 14 bytes`. */
export const kindText = (/** @type {{ kind?: string, size?: number }} */ l) =>
  `${l.kind ?? 'code'}${l.size === undefined ? '' : `, ${l.size.toLocaleString('en-US')} ${l.size === 1 ? 'byte' : 'bytes'}`}`;

export default {
  name: 'label',
  description:
    'Name an address: name is an identifier (a letter or _, then letters, digits, or _, up to 32 characters; not a Z80 mnemonic or register, and not a generated shape such as SUB_7030); kind is "code" (default) or "data"; size is how many bytes it covers (a decimal count); note is a remark for a human reader (what it is, how you know), shown with the label and as the disassembler\'s comment. A second label at the same address replaces the first. Every address argument and disasm, peek, and trace use the name at once, and the sidecar file <program>.fugloy.json beside the program is rewritten.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('The address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    name: z.string().describe('The name, an identifier of up to 32 characters'),
    kind: z.enum(['code', 'data']).optional().describe('"code" (default) or "data"'),
    size: z.number().int().optional().describe('How many bytes the label covers, a decimal count (1 to 65536)'),
    note: z.string().optional().describe('A remark for a human reader: what it is and how you know (one line)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, name: string, kind?: 'code' | 'data', size?: number, note?: string }} args
   */
  handler(session, { addr, name, kind = 'code', size, note }) {
    const { sidecar } = session.requireProgram();
    const at = parseAddr(addr, session.labels);
    const problem = nameProblem(name);
    if (problem !== null) {
      const why = WHY.find(([re]) => /** @type {RegExp} */ (re).test(problem))?.[1];
      throw new Error(`The ${problem}${why ? ` (${why})` : ''}; choose another name.`);
    }
    if (size !== undefined) parseCount(size, { name: 'size', min: 1, max: 0x10000 });
    if (note !== undefined && CONTROL.test(note)) throw new Error('note must not contain a control character (a new line would break the listing).');
    for (const l of session.labels.values()) {
      if (l.addr !== at && l.name.toUpperCase() === name.toUpperCase()) {
        throw new Error(`The name ${l.name} is already the label at ${hex4(l.addr)}; unlabel it first or choose another name.`);
      }
    }
    const old = session.labels.get(at);
    /** @type {import('../session.js').Label} */
    const label = { addr: at, name, kind, ...(size === undefined ? {} : { size }), source: 'user', ...(note ? { note } : {}) };
    session.labels.set(at, label);
    const done = `Labelled ${hex4(at)} ${name} (${kindText(label)})`;
    const replaced = old !== undefined && old.name !== name ? `, replacing ${old.name}` : '';
    // An all-hex name reads as a hex address too, so address arguments refuse it as ambiguous.
    const hexName = /^[0-9a-f]+$/i.test(name)
      ? `\nNote: ${name} is all hex digits, so an address argument "${name}" is refused as ambiguous (it is also ${hex4(Number.parseInt(name, 16) & 0xffff)}); refer to this label as ${at} (decimal), or relabel it with a name that has a letter past F.`
      : '';
    if (sidecar.ignored !== null) {
      return {
        text: `${done}${replaced} for this session only: the sidecar ${sidecar.readFrom} was ignored at load (${sidecar.ignored}), so it was not overwritten; fix or remove it and load again, or save with coverage mode "export" and a path.${hexName}`,
        isError: true,
      };
    }
    try {
      return `${done}${replaced}.\nWrote ${writeSidecar(session)}.${hexName}`;
    } catch (err) {
      return { text: `${done}${replaced} in this session, but ${err instanceof Error ? err.message : String(err)}${hexName}`, isError: true };
    }
  },
};
