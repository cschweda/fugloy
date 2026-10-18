/**
 * The MCP resources (docs/fugloy-mcp-spec.md §6): read-only text, for context without a tool
 * call. Reading one never changes the session: `fugloy://screen` does not move the baseline that
 * `screen diff: true` compares with, and nothing is paged or capped (a resource has no offset).
 * A resource that needs a program before one is loaded reads as the sentence the tool would
 * give, not as a protocol error.
 *
 * `fugloy://rom/{model}/symbols` (Ruling 5) is generated from @fugloy/disasm's cited symbol
 * tables, the ROM and hardware ones of the model (the machine 3 or machine 1, no-DOS selection,
 * as the disasm tool uses), one line per entry: address (or port), kind, name, and purpose.
 */
import { selectSymbols } from '@fugloy/disasm';
import { hex4, MODELS } from './args.js';
import { geometryOf, screenText } from './format/screen.js';
import labels from './tools/labels.js';
import status from './tools/status.js';

/** `0033h`, `3C00h–3FFFh`, or `port FFh`, for a symbol table entry. */
function where(/** @type {import('@fugloy/disasm').TableEntry} */ e) {
  if (e.kind === 'port') return `port ${e.key.toString(16).toUpperCase().padStart(2, '0')}h`;
  return e.length > 1 ? `${hex4(e.key)}–${hex4(e.key + e.length - 1)}` : hex4(e.key);
}

/** @type {Map<number, string>} The symbols text by model, built once each. */
const symbolsText = new Map();

/**
 * The ROM and hardware symbols of model `model` (3, the Model III, or 1, the Model I) as text, built once.
 * @param {1 | 3} [model]
 */
export function romSymbolsText(model = 3) {
  const built = symbolsText.get(model);
  if (built !== undefined) return built;
  const entries = selectSymbols({ machine: model, dos: 'none' }).entries();
  const table = `rom-model${model}`;
  const rom = entries.filter((e) => e.table === table);
  const hardware = entries.filter((e) => e.table !== table);
  const width = Math.max(...entries.map((e) => where(e).length));
  const nameWidth = Math.max(...entries.map((e) => e.name.length));
  const row = (/** @type {import('@fugloy/disasm').TableEntry} */ e) =>
    `${where(e).padEnd(width)}  ${e.kind.padEnd(8)}  ${e.name.padEnd(nameWidth)}  ${e.purpose}`;
  const text = [
    `Model ${MODELS[model]} ROM and hardware symbols (${entries.length} entries), from @fugloy/disasm's cited tables; addresses are hex.`,
    'A CALL or RST to one of these addresses is a call into the ROM; callers on the address shows who made it.',
    '',
    `ROM: entry points and the RAM variables it keeps (${rom.length}):`,
    ...rom.map(row),
    '',
    `Hardware: memory-mapped regions and ports (${hardware.length}):`,
    ...hardware.map(row),
  ].join('\n');
  symbolsText.set(model, text);
  return text;
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
      return screenText(m.video.raw, geometryOf(m));
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
      const { program } = session.requireProgram();
      return program.manifestText ?? `${program.name} is loaded from ${program.path}, and the manifest load returned for it was not kept; call load again to see it.`;
    }),
  },
];

/** The ROM symbols resource template. */
export const ROM_SYMBOLS = {
  uriTemplate: 'fugloy://rom/{model}/symbols',
  name: 'rom-symbols',
  description: 'Known ROM entry points, memory-mapped regions, and ports of a model (3, the Model III, or 1, the Model I), with their names and purposes, so ROM calls can be recognized: fugloy://rom/3/symbols, fugloy://rom/1/symbols.',
  /** @param {string} model */
  read(model) {
    if (model === '3') return romSymbolsText(3);
    if (model === '1') return romSymbolsText(1);
    if (model === '4') {
      return 'There is no Model 4 table: the Model 4 runs here in Model III mode, where disasm and callees name from the Model III\'s tables (its ROM differs from the Model III\'s in 727 bytes, so a name from them is unchecked on the Model 4); read fugloy://rom/3/symbols (the Model III).';
    }
    return `${JSON.stringify(model)} is not a model; read fugloy://rom/3/symbols (the Model III) or fugloy://rom/1/symbols (the Model I).`;
  },
};
