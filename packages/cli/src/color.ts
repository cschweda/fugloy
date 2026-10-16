/**
 * ANSI color for a listing on a terminal. It reads the listing's fixed layout
 * (address, bytes padded to column 20, text, `;` comment) and only adds escape
 * codes, never changing a character. zmac source and the IR are never colored:
 * they are input to other tools.
 */

const SGR = {
  addr: '36',
  bytes: '2',
  mnemonic: '94',
  directive: '35',
  register: '32',
  number: '33',
  symbol: '96',
  string: '31',
  comment: '90',
  warning: '33',
  unparsed: '31',
} as const;

type Style = keyof typeof SGR;

const paint = (style: Style, text: string): string => (text === '' ? '' : `\x1b[${SGR[style]}m${text}\x1b[0m`);

const REGISTERS = new Set([
  'A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'AF', "AF'", 'BC', 'DE', 'HL', 'SP', 'IX', 'IY', 'IXH', 'IXL', 'IYH', 'IYL',
  'NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M',
]);
const DIRECTIVES = new Set(['DB', 'DW', 'DS', 'ORG', 'END', 'EQU', '.PHASE', '.DEPHASE']);

/** `5200  31 27 6F      LD SP,6F27H`: four-digit address, two spaces, up to four bytes padded to 12, two spaces, text. */
const ROW = /^([0-9A-F]{4})  ([0-9A-F]{2}(?: [0-9A-F]{2}){0,3})( +)(\S.*)$/;
/**
 * Operand tokens: a string as the emitter quotes it (`'IT''S'`), a name (the
 * apostrophe of AF' included, so it never opens a string), a number, or one
 * other character.
 */
const OPERAND = /'(?:[^']|'')*'?|[A-Za-z_.][A-Za-z0-9_.]*'?|[0-9][0-9A-Fa-f]*H?|[^]/g;

function token(t: string): string {
  if (t.startsWith("'")) return paint('string', t);
  if (/^[0-9]/.test(t)) return paint('number', t);
  if (/^[A-Za-z_.]/.test(t)) return paint(REGISTERS.has(t.toUpperCase()) ? 'register' : 'symbol', t);
  return t;
}

const operands = (text: string): string => text.replace(OPERAND, token);

/** Mnemonic and operands, then a comment from the first `;` token, which is never inside a string. */
function rowText(text: string): string {
  const space = text.indexOf(' ');
  const mnemonic = space < 0 ? text : text.slice(0, space);
  const rest = space < 0 ? '' : text.slice(space);
  let out = paint(DIRECTIVES.has(mnemonic) ? 'directive' : 'mnemonic', mnemonic);
  for (const m of rest.matchAll(OPERAND)) {
    if (m[0] === ';') return out + paint('comment', rest.slice(m.index));
    out += token(m[0]);
  }
  return out;
}

function line(text: string): string {
  if (text === '') return text;
  if (text.startsWith(';')) return paint(text.startsWith('; warning:') ? 'warning' : 'comment', text);
  const row = ROW.exec(text);
  if (row !== null && row[2]!.length + row[3]!.length === 14) return `${paint('addr', row[1]!)}  ${paint('bytes', row[2]!)}${row[3]}${rowText(row[4]!)}`;
  const directive = /^( {8})(\S+)(.*)$/.exec(text);
  if (directive !== null) return directive[1]! + paint('directive', directive[2]!) + operands(directive[3]!);
  if (/^[A-Za-z_.][A-Za-z0-9_.]*:$/.test(text)) return paint('symbol', text);
  const basic = /^(\d+)( \[unparsed: .*\])$|^(\d+)(.*)$/.exec(text);
  if (basic?.[1] !== undefined) return `${paint('addr', basic[1])} ${paint('unparsed', basic[2]!.slice(1))}`;
  if (basic?.[3] !== undefined) return paint('addr', basic[3]) + basic[4];
  return text;
}

export function colorListing(text: string): string {
  return text.split('\n').map(line).join('\n');
}
