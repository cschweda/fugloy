/**
 * The MCP resources (docs/fugloy-mcp-spec.md §6): read-only text, for context without a tool
 * call. Reading one never changes the session: `fugloy://screen` does not move the baseline that
 * `screen diff: true` compares with, and nothing is paged or capped (a resource has no offset).
 * A resource that needs a program before one is loaded reads as the sentence the tool would
 * give, not as a protocol error.
 *
 * `fugloy://rom/{model}/symbols` (Ruling 5) is generated from @fugloy/disasm's cited symbol
 * tables, the Model III ROM and hardware ones (the machine 3, no-DOS selection, as the disasm
 * tool uses), one line per entry: address (or port), kind, name, and purpose.
 */
import { selectSymbols } from '@fugloy/disasm';
import { hex4, MODELS } from './args.js';
import { screenText } from './format/screen.js';
import labels from './tools/labels.js';
import status from './tools/status.js';

/** `0033h`, `3C00h–3FFFh`, or `port FFh`, for a symbol table entry. */
function where(/** @type {import('@fugloy/disasm').TableEntry} */ e) {
  if (e.kind === 'port') return `port ${e.key.toString(16).toUpperCase().padStart(2, '0')}h`;
  return e.length > 1 ? `${hex4(e.key)}–${hex4(e.key + e.length - 1)}` : hex4(e.key);
}

/** @type {string | undefined} */
let model3Symbols;

/** The Model III ROM and hardware symbols as text, built once. */
export function romSymbolsText() {
  if (model3Symbols !== undefined) return model3Symbols;
  const entries = selectSymbols({ machine: 3, dos: 'none' }).entries();
  const rom = entries.filter((e) => e.table === 'rom-model3');
  const hardware = entries.filter((e) => e.table !== 'rom-model3');
  const width = Math.max(...entries.map((e) => where(e).length));
  const nameWidth = Math.max(...entries.map((e) => e.name.length));
  const row = (/** @type {import('@fugloy/disasm').TableEntry} */ e) =>
    `${where(e).padEnd(width)}  ${e.kind.padEnd(8)}  ${e.name.padEnd(nameWidth)}  ${e.purpose}`;
  model3Symbols = [
    `Model III ROM and hardware symbols (${entries.length} entries), from @fugloy/disasm's cited tables; addresses are hex.`,
    'A CALL or RST to one of these addresses is a call into the ROM; callers on the address shows who made it.',
    '',
    `ROM: entry points and the RAM variables it keeps (${rom.length}):`,
    ...rom.map(row),
    '',
    `Hardware: memory-mapped regions and ports (${hardware.length}):`,
    ...hardware.map(row),
  ].join('\n');
  return model3Symbols;
}

/** A handler's text, or the sentence it threw. */
function textOf(/** @type {() => string} */ make) {
  try {
    return make();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * @typedef {{ uri: string, name: string, description: string, read: (session: import('./session.js').Session) => string }} ResourceDef
 */

/** The fixed resources, in listing order. */
/** @type {ResourceDef[]} */
export const RESOURCES = [
  {
    uri: 'fugloy://status',
    name: 'status',
    description: 'The session, as the status tool shows it: model, program, cycles, PC, counts, the ROM, and the config file.',
    read: (session) => textOf(() => status.handler(session)),
  },
  {
    uri: 'fugloy://screen',
    name: 'screen',
    description: 'The screen as text, as the screen tool shows it (reading it does not reset screen diff\'s baseline).',
    read: (session) => textOf(() => {
      const m = session.requireMachine();
      return screenText(m.video.raw, m.video.columns === 32);
    }),
  },
  {
    uri: 'fugloy://labels',
    name: 'labels',
    description: 'The loaded program\'s labels, as the labels tool shows them.',
    read: (session) => textOf(() => labels.handler(session, {})),
  },
  {
    uri: 'fugloy://program/manifest',
    name: 'manifest',
    description: 'The manifest load returned for the loaded program: format, blocks, entry point, the ROM, the sidecar file, and the path.',
    read: (session) => textOf(() => {
      session.requireProgram();
      return /** @type {string} */ (session.program?.manifestText);
    }),
  },
];

/** The ROM symbols resource template. */
export const ROM_SYMBOLS = {
  uriTemplate: 'fugloy://rom/{model}/symbols',
  name: 'rom-symbols',
  description: 'Known ROM entry points, memory-mapped regions, and ports of a model (only 3, the Model III, until emu phase 6), with their names and purposes, so ROM calls can be recognized: fugloy://rom/3/symbols.',
  /** @param {string} model */
  read(model) {
    if (model === '3') return romSymbolsText();
    const n = Number(model);
    if (/^\d+$/.test(model) && MODELS[n] !== undefined) {
      return `There are no Model ${MODELS[n]} symbols here yet: only the Model III exists until emu phase 6 adds the Model I and the Model 4; read fugloy://rom/3/symbols.`;
    }
    return `${JSON.stringify(model)} is not a model; read fugloy://rom/3/symbols (the Model III).`;
  },
};
