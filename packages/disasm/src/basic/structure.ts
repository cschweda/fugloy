/**
 * Types a .BAS program's structure for Pass 1 (spec §3, §5.3). Line headers
 * (next-line pointer, line number) are words; terminators are bytes; a BASIC
 * body is bytes with its text attached, so descent never decodes BASIC; a
 * code line's body start is a root, and descent decides what inside it is
 * code. The 00 00 end marker is typed as one word.
 */
import type { BasLine, BasProgram } from '../bas.js';
import { emptyAnnotations } from '../hints/apply.js';
import type { Annotations } from '../hints/apply.js';

export interface BasStructure {
  annotations: Annotations;
  /** Body address → `N text` for every line that parses as BASIC. */
  texts: Map<number, string>;
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** `line N: machine code, K bytes at $XXXX`, counting the code bytes without the terminator. */
export function codeLineLabel(line: BasLine): string {
  const n = line.body.length;
  const k = n > 0 && line.body[n - 1] === 0 ? n - 1 : n;
  return `line ${line.number}: machine code, ${k} byte${k === 1 ? '' : 's'} at $${hex4(line.bodyAddr)}`;
}

export function basStructure(prog: BasProgram): BasStructure {
  const annotations = emptyAnnotations();
  const texts = new Map<number, string>();
  for (const line of prog.lines) {
    annotations.overrides.push({ addr: line.addr, kind: 'words', length: 4 });
    const n = line.body.length;
    const terminated = n > 0 && line.body[n - 1] === 0;
    const content = terminated ? n - 1 : n;
    if (line.parsed) {
      if (content > 0) annotations.overrides.push({ addr: line.bodyAddr, kind: 'bytes', length: content });
      texts.set(line.bodyAddr, line.text === '' ? `${line.number}` : `${line.number} ${line.text}`);
    } else {
      annotations.entries.push(line.bodyAddr);
    }
    if (terminated) annotations.overrides.push({ addr: (line.bodyAddr + content) & 0xffff, kind: 'bytes', length: 1 });
  }
  if (prog.lines.length > 0) annotations.overrides.push({ addr: prog.end, kind: 'words', length: 2 });
  return { annotations, texts };
}
