// Open as source ✎ (plan 5B, Task 5), from the Program tab or Export ▾: the open program becomes a
// new source (useSources.fromSession) and the page shows it in Source ✎ (it watches `requests`).
// Then, off the first screen, asm checks that the text assembles back to the program; when it does
// not, `note` holds one sentence for Source ✎ to show above that source. The disassembly stays open:
// a Run of the new source never replaces it (Ruling 10).
import { ref } from 'vue';
import type { Ref } from 'vue';
import type { Session } from '@fugloy/disasm';
import { useSources } from './useSources';
import type { Source, Sources } from './useSources';

export interface OpenAsSource {
  /** Whether the program can become a source: machine code, not a BASIC program. */
  can(s: Session): boolean;
  /** Makes the source, current, and asks the page for Source ✎; the note follows. */
  open(s: Session): Promise<Source>;
  /** Bumped on each open; the page shows Source ✎ when it changes. */
  requests: Ref<number>;
  /** The reassembly note for one source: the first address that differs, as a sentence. */
  note: Ref<{ sourceId: string; text: string } | null>;
}

export interface OpenAsSourceDeps {
  sources?: Sources;
  /** The source text (tests); the zmac rendering otherwise, which is what the source gets. */
  render?: (s: Session) => string;
}

export function createOpenAsSource(deps: OpenAsSourceDeps = {}): OpenAsSource {
  const requests = ref(0);
  const note = ref<{ sourceId: string; text: string } | null>(null);
  const can = (s: Session): boolean => s.module.format !== 'bas';

  async function open(s: Session): Promise<Source> {
    if (!can(s)) throw new Error(`${s.name} is a BASIC program, so it has no Z80 source to open. Open a .CMD program instead.`);
    const sources = deps.sources ?? useSources();
    const src = await sources.fromSession(s, deps.render?.(s));
    note.value = null;
    requests.value++;
    try {
      const { reassemblyNote } = await import('../utils/source/reassembly');
      const text = reassemblyNote(s, src.text, src.model);
      if (text !== null) note.value = { sourceId: src.id, text };
    } catch {
      // The check is a courtesy: without it the source still opens, and Source ✎ checks it as usual.
    }
    return src;
  }

  return { can, open, requests, note };
}

let shared: OpenAsSource | null = null;

/** The page's opener (one per app). */
export function useOpenAsSource(): OpenAsSource {
  shared ??= createOpenAsSource();
  return shared;
}
