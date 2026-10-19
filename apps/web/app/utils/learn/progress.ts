// What a learner has done on the Learn page, kept in the browser's localStorage: each lesson's
// edited program (`fugloy:learn:edit:<slug>`) and the lessons marked done (`fugloy:learn:done`, a
// JSON array of slugs). Every storage access is guarded; when storage is blocked or absent,
// everything lives in memory for the visit.

export interface Progress {
  /** The saved edit, or null. */
  edit(slug: string): string | null;
  /** Text equal to the lesson's own removes the edit. */
  saveEdit(slug: string, text: string): void;
  clearEdit(slug: string): void;
  done(): ReadonlySet<string>;
  markDone(slug: string): void;
}

const EDIT = 'fugloy:learn:edit:';
const DONE = 'fugloy:learn:done';

function defaultStorage(): Storage | null {
  return globalThis.localStorage ?? null;
}

export function createProgress(
  lessonText: (slug: string) => string,
  storage: () => Storage | null = defaultStorage,
): Progress {
  // Memory is authoritative for a slug once written or cleared this visit (null = cleared).
  const edits = new Map<string, string | null>();
  const doneSet = new Set<string>();
  let doneLoaded = false;

  function store(): Storage | null {
    try {
      return storage();
    } catch {
      return null;
    }
  }

  function loadDone(): void {
    if (doneLoaded) return;
    doneLoaded = true;
    try {
      const raw = store()?.getItem(DONE);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) for (const s of parsed) if (typeof s === 'string') doneSet.add(s);
    } catch {
      /* corrupt or unreadable: none */
    }
  }

  return {
    edit(slug) {
      if (edits.has(slug)) return edits.get(slug) ?? null;
      try {
        const v = store()?.getItem(EDIT + slug);
        if (typeof v === 'string') return v;
      } catch {
        /* fall back to memory */
      }
      return null;
    },
    saveEdit(slug, text) {
      if (text === lessonText(slug)) {
        this.clearEdit(slug);
        return;
      }
      edits.set(slug, text);
      try {
        store()?.setItem(EDIT + slug, text);
      } catch {
        /* kept in memory */
      }
    },
    clearEdit(slug) {
      edits.set(slug, null);
      try {
        store()?.removeItem(EDIT + slug);
      } catch {
        /* memory already cleared */
      }
    },
    done() {
      loadDone();
      return new Set(doneSet);
    },
    markDone(slug) {
      loadDone();
      doneSet.add(slug);
      try {
        store()?.setItem(DONE, JSON.stringify([...doneSet]));
      } catch {
        /* kept in memory */
      }
    },
  };
}
