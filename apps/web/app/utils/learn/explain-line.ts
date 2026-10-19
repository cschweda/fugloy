// Explain's sentence for a line of a lesson's program (phase 6B Task 4), as the workbench's Explain
// tab says it for a listing row: the line's first run address (asm's source map), the program's
// .CMD opened as a disassembler session with the model's default symbols, and the lead sentences of
// explainLine at that address. A line with no instruction (a comment, ORG, a label alone, data)
// has none. The session is kept per .CMD, so clicking line after line opens it once. Loaded only by
// the lesson editor (a lazy root), so the disassembler's explain engine stays off the first screen.
import { defaultDos, explainLine, openProgram, sentenceText } from '@fugloy/disasm';
import type { Session } from '@fugloy/disasm';
import type { AsmResult } from '@fugloy/asm';

const sessions = new WeakMap<Uint8Array, Map<1 | 3, Session>>();

function sessionOf(bytes: Uint8Array, model: 1 | 3): Session {
  let byModel = sessions.get(bytes);
  if (byModel === undefined) {
    byModel = new Map();
    sessions.set(bytes, byModel);
  }
  let s = byModel.get(model);
  if (s === undefined) {
    s = openProgram(bytes, { name: 'lesson.cmd', selection: { machine: model, dos: defaultDos(model) } });
    byModel.set(model, s);
  }
  return s;
}

/** Explain's lead sentences for source line `line` of the program `result` assembled to `bytes` (its .CMD); null for a line with no code. */
export function explainSourceLine(result: AsmResult, bytes: Uint8Array, line: number, model: 1 | 3): string | null {
  const addr = result.sourceMap.addressesOf(line)[0];
  if (addr === undefined) return null;
  const e = explainLine(sessionOf(bytes, model), addr);
  if (e.kind !== 'code' || e.sentences.length === 0) return null;
  return e.sentences.map(sentenceText).join(' ');
}
