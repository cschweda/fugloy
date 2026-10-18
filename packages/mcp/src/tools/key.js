/**
 * `key`: type on the keyboard (docs/fugloy-mcp-spec.md §5, Ruling 8). By default through the
 * matrix at 20 characters a second, then the machine runs until every key is delivered plus
 * 0.2 s emulated (capped like `run`); mode "hook" feeds the ROM keyboard-scan hook instead.
 */
import { CPU_CLOCK_HZ } from '@fugloy/emu';
import { z } from 'zod';
import { capCycles, runMachine, seconds, stoppedLine, wallDeadline } from '../execute.js';
import { screenDiff } from '../format/screen.js';

const NAMES = ['ENTER', 'BREAK', 'CLEAR', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SHIFT', 'SPACE'];
/** Named keys the hook can return: those with a character the ROM routine gives back unambiguously. */
const HOOK_CHARS = { ENTER: '\n', SPACE: ' ' };
/** Emulated time `run` keeps going after the last key, so the program can react (Ruling 8). */
const AFTER = Math.round(0.2 * CPU_CLOCK_HZ);

export default {
  name: 'key',
  description:
    'Type keys: text (characters; "\\n" is ENTER), then keys (named keys: ENTER, BREAK, CLEAR, UP, DOWN, LEFT, RIGHT, SHIFT, SPACE). mode "matrix" (default) presses each through the keyboard matrix at cps characters a second (default 20); "hook" hands them to the ROM\'s keyboard routine. With run (default true) the machine runs until every key is delivered and 0.2 s more. Returns the cycles run and the screen diff.',
  inputSchema: {
    text: z.string().optional().describe('Characters to type; "\\n" is ENTER'),
    keys: z.array(z.string()).optional().describe('Named keys to press after text: ENTER, BREAK, CLEAR, UP, DOWN, LEFT, RIGHT, SHIFT, SPACE'),
    cps: z.number().optional().describe('Characters a second in matrix mode (default 20); slow programs may need fewer'),
    mode: z.enum(['matrix', 'hook']).optional().describe('"matrix" (default) or "hook"'),
    run: z.boolean().optional().describe('Run until the keys are delivered, plus 0.2 s (default true)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ text?: string, keys?: string[], cps?: number, mode?: 'matrix' | 'hook', run?: boolean }} args
   */
  handler(session, { text = '', keys = [], cps = 20, mode = 'matrix', run = true }) {
    const m = session.requireMachine();
    if (text === '' && keys.length === 0) throw new Error('Give text or keys to type.');
    if (!(cps > 0) || !Number.isFinite(cps)) throw new Error(`cps must be a positive number of characters a second, not ${cps}.`);
    const named = keys.map((k) => {
      const up = k.toUpperCase();
      if (!NAMES.includes(up)) throw new Error(`"${k}" is not a key name; use ${NAMES.join(', ')}, or put characters in text.`);
      return up;
    });
    /** @type {string[]} */
    let tokens;
    if (mode === 'hook') {
      for (const k of named) {
        if (!Object.hasOwn(HOOK_CHARS, k)) throw new Error(`${k} cannot be fed to the ROM keyboard hook (only ENTER and SPACE can); use mode "matrix".`);
      }
      tokens = [...Array.from(text), ...named.map((k) => HOOK_CHARS[/** @type {'ENTER' | 'SPACE'} */ (k)])];
    } else tokens = [...Array.from(text), ...named];
    try {
      // type takes an array of keys, each a character or a key name (emu spec §3).
      if (mode === 'hook') m.keyboard.feed(tokens.join(''));
      else m.keyboard.type(/** @type {any} */ (tokens), { cps });
    } catch (err) {
      throw new Error(`Nothing was typed: ${(err instanceof Error ? err.message : String(err)).replace(/^(?:type|feed): /, '')}.`);
    }
    const what = `${tokens.length} ${tokens.length === 1 ? 'key' : 'keys'} (${mode === 'hook' ? 'fed to the ROM keyboard hook' : `matrix, ${cps} cps`})`;
    if (!run) return `Queued ${what}; nothing ran yet (call run to deliver them).`;

    const before = Uint8Array.from(m.video.raw);
    const cap = capCycles(session.config);
    // One wall-clock deadline for both runs, so the call as a whole keeps to limits.runSecondsWall.
    const deadline = wallDeadline(session);
    let stop = runMachine(session, { budget: cap, until: 'drained', deadline });
    let ran = stop.cycles;
    if (stop.reason === 'drained' && ran < cap) {
      const tail = runMachine(session, { budget: Math.min(AFTER, cap - ran), deadline });
      ran += tail.cycles;
      stop = tail.reason === 'cycles' ? { reason: 'drained', cycles: ran } : { ...tail, cycles: ran };
    }
    const lines = [`Typed ${what}`, `Ran ${ran.toLocaleString('en-US')} cycles (${seconds(ran)} emulated)`];
    if (stop.reason !== 'drained') {
      lines.push(stoppedLine(stop, session, { capped: true }));
      if (m.keyboard.pending > 0) lines.push(`${m.keyboard.pending} key events were still queued; call run to deliver them.`);
    }
    lines.push(screenDiff(before, m.video.raw, m.video.columns === 32));
    return lines.join('\n');
  },
};
