/**
 * The golden-transcript stories (MCP spec §10, §13): scripted tool sequences on the synthetic ROM
 * and synthetic programs, replayed through the protocol and byte-compared with the committed
 * `test/golden/story-0N.txt`. Only synthetic sessions are committed (no ROM text in them).
 *
 * Each replay gets a folder of its own, so a sidecar one replay writes never reaches the next,
 * and the folder's path reads `<dir>` in the transcript and in each call's text. `preamble` calls run first and are left
 * out of the transcript.
 *
 * To rewrite the transcripts after a deliberate change to a tool's output, run
 * `FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/golden.test.js` and review the diff.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAIDERS, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

/**
 * SCORER, the story 2 program: waits for A (keyboard row 0, 3801h bit 1), adds 100 to the
 * little-endian SCORE word at 7E10h, counts the press in the byte at 7E20h, waits for A to be
 * let go, and goes round again. No calls, so the stack never shows in a diff.
 */
export const SCORER = buildCmd(
  [
    { name: 'SCORER' },
    {
      addr: 0x7000,
      data: [
        0x31, 0x00, 0x7f, //  7000  LD SP,7F00H
        0x3a, 0x01, 0x38, //  7003  LD A,(3801H)
        0xe6, 0x02, //        7006  AND 02H
        0x28, 0xf9, //        7008  JR Z,7003H
        0x2a, 0x10, 0x7e, //  700A  LD HL,(7E10H)
        0x11, 0x64, 0x00, //  700D  LD DE,0064H
        0x19, //              7010  ADD HL,DE
        0x22, 0x10, 0x7e, //  7011  LD (7E10H),HL
        0x21, 0x20, 0x7e, //  7014  LD HL,7E20H
        0x34, //              7017  INC (HL)
        0x3a, 0x01, 0x38, //  7018  LD A,(3801H)
        0xe6, 0x02, //        701B  AND 02H
        0x20, 0xf9, //        701D  JR NZ,7018H
        0x18, 0xe2, //        701F  JR 7003H
      ],
    },
  ],
  0x7000,
);

/**
 * TABLER, the story 3 program: one block, 7000h–7051h, holding code, data, and bytes nothing
 * touches. It copies the eight-byte TABLE at 7040h to 7E00h, reads the FLAG byte at 7050h, and,
 * since FLAG is zero, skips the CALL to the routine at 7030h (which never runs), stores A in the
 * byte at 7051h, and loops forever. Coverage tells them apart: 7000h–701Eh less the CALL's three
 * bytes executed, 7040h–7047h and 7050h–7051h data, the rest never seen.
 */
export const TABLER = (() => {
  const code = new Array(0x52).fill(0);
  const place = (addr, bytes) => code.splice(addr - 0x7000, bytes.length, ...bytes);
  place(0x7000, [0x31, 0x00, 0x7f]); //  7000  LD SP,7F00H
  place(0x7003, [0x21, 0x40, 0x70]); //  7003  LD HL,7040H
  place(0x7006, [0x11, 0x00, 0x7e]); //  7006  LD DE,7E00H
  place(0x7009, [0x06, 0x08]); //        7009  LD B,8
  place(0x700b, [0x7e]); //              700B  LD A,(HL)
  place(0x700c, [0x12]); //              700C  LD (DE),A
  place(0x700d, [0x23, 0x13]); //        700D  INC HL / INC DE
  place(0x700f, [0x10, 0xfa]); //        700F  DJNZ 700BH
  place(0x7011, [0x3a, 0x50, 0x70]); //  7011  LD A,(7050H)
  place(0x7014, [0xb7]); //              7014  OR A
  place(0x7015, [0x28, 0x03]); //        7015  JR Z,701AH
  place(0x7017, [0xcd, 0x30, 0x70]); //  7017  CALL 7030H (never taken)
  place(0x701a, [0x32, 0x51, 0x70]); //  701A  LD (7051H),A
  place(0x701d, [0x18, 0xfe]); //        701D  JR 701DH
  place(0x7030, [0x3e, 0x01, 0xc9]); //  7030  LD A,1 / RET (never runs)
  place(0x7040, [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]); // TABLE
  return buildCmd([{ name: 'TABLER' }, { addr: 0x7000, data: code }], 0x7000);
})();

/**
 * @typedef {[string, Record<string, unknown>]} Call
 * @typedef {{
 *   id: string,
 *   title: string,
 *   files: Record<string, Uint8Array>,
 *   preamble?: (at: (name: string) => string) => Call[],
 *   script: (at: (name: string) => string) => Call[],
 * }} Story
 */

/** @type {Story[]} */
export const STORIES = [
  {
    id: '01',
    title: 'story 1 on a synthetic print routine',
    files: { 'raiders.cmd': RAIDERS },
    script: (at) => [
      ['load', { path: at('raiders.cmd') }],
      ['run', { until: 'screen' }],
      ['watch', { addr: '3C00', len: 1024 }],
      ['key', { keys: ['ENTER'] }],
      ['hits', { n: 10 }],
      ['callers', { addr: '7030' }],
      ['disasm', { addr: '7030', n: 8 }],
    ],
  },
  {
    id: '02',
    title: 'story 2 on a synthetic program',
    files: { 'scorer.cmd': SCORER },
    preamble: (at) => [['load', { path: at('scorer.cmd') }]],
    script: () => [
      ['snapshot', { name: 'before' }],
      ['key', { text: 'A' }],
      ['run', { seconds: 1 }],
      ['diff', { a: 'before', b: 'now', range: '4000-7FFF' }],
      ['peek', { addr: '7E10', len: 2 }],
      ['key', { text: 'A' }],
      ['run', { seconds: 1 }],
      ['peek', { addr: '7E10', len: 2 }],
      ['label', { addr: '7E10', name: 'SCORE', kind: 'data', size: 2, note: 'increments by 100 per press of A; little-endian' }],
      ['diff', { a: 'before', b: 'now', range: '4000-7FFF' }],
      ['snapshots', {}],
    ],
  },
  {
    id: '03',
    title: 'story 3: coverage separates code from data on a synthetic program',
    files: { 'tabler.cmd': TABLER },
    script: (at) => [
      ['load', { path: at('tabler.cmd') }],
      ['run', { seconds: 0.1 }],
      ['coverage', {}],
      ['coverage', { mode: 'ranges' }],
      ['disasm', { addr: '7011', n: 6 }],
      ['disasm', { addr: '7030', n: 2 }],
      ['label', { addr: '7040', name: 'TABLE', kind: 'data', size: 8, note: 'read a byte at a time by the copy loop at 700Bh' }],
      ['label', { addr: '7050', name: 'FLAG', kind: 'data', note: 'read at 7011h; zero, so the CALL at 7017h is skipped' }],
      ['peek', { addr: '7040', len: 18 }],
      ['coverage', { mode: 'export' }],
      ['coverage', {}],
    ],
  },
];

/**
 * Replay `story` on a fresh server in a folder of its own, and return its transcript (with the
 * folder as `<dir>`) and each scripted call's text. A call that fails throws, naming it.
 * @param {Story} story
 * @returns {Promise<{ transcript: string, out: string[] }>}
 */
export async function replay(story) {
  const dir = mkdtempSync(join(tmpdir(), `fugloy-mcp-story-${story.id}-`));
  const at = (/** @type {string} */ name) => join(dir, name);
  try {
    writeFileSync(at('synthetic.rom'), syntheticRom());
    for (const [name, bytes] of Object.entries(story.files)) writeFileSync(at(name), bytes);
    const { call, close } = await connect({ config: testConfig({ roms: { model3: at('synthetic.rom') } }) });
    const run = async (/** @type {Call} */ [name, args]) => {
      const r = await call(name, args);
      if (r.isError) throw new Error(`story ${story.id}: ${name} failed: ${r.text}`);
      return r.text;
    };
    try {
      for (const c of story.preamble?.(at) ?? []) await run(c);
      const parts = [];
      const out = [];
      for (const c of story.script(at)) {
        const text = await run(c);
        out.push(text.replaceAll(dir, '<dir>'));
        parts.push(`> ${c[0]} ${JSON.stringify(c[1])}\n${text}\n`);
      }
      return { transcript: parts.join('\n').replaceAll(dir, '<dir>'), out };
    } finally {
      await close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The committed transcript of `story`. */
export const goldenPath = (/** @type {Story} */ story) => fileURLToPath(new URL(`./golden/story-${story.id}.txt`, import.meta.url));

/**
 * The committed transcript of `story`, first rewritten from `transcript` when
 * FUGLOY_UPDATE_GOLDEN=1. Throws a sentence when it is missing.
 * @param {Story} story
 * @param {string} transcript
 */
export function golden(story, transcript) {
  const path = goldenPath(story);
  if (process.env.FUGLOY_UPDATE_GOLDEN === '1') {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, transcript);
  }
  if (!existsSync(path)) throw new Error(`${path} is missing; run with FUGLOY_UPDATE_GOLDEN=1 to write it, then review it.`);
  return readFileSync(path, 'utf8');
}

/** The story with this id. */
export const story = (/** @type {string} */ id) => /** @type {Story} */ (STORIES.find((s) => s.id === id));
