import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyHints, openProgram, parseHints, writeHints } from '@fugloy/disasm';
import { bestCarryOver } from '../app/utils/carry-over';
import { asHintText } from '../app/utils/hint-drop';
import { openStore } from '../app/utils/store';
import type { Store } from '../app/utils/store';

const ex = (p: string): Buffer => readFileSync(fileURLToPath(new URL(`../../../examples/${p}`, import.meta.url)));
const sea = (f: string) => openProgram(new Uint8Array(ex(`sea-dragon/${f}`)), { name: f });

let store: Store;
beforeEach(async () => {
  // A fresh database per test.
  store = (await openStore())!;
});
afterEach(async () => {
  store.db.close();
  await new Promise((r) => (indexedDB.deleteDatabase('fugloy').onsuccess = r));
});

describe('store', () => {
  it('round-trips hints and prefs, lists them and forgets a program', async () => {
    expect(store).not.toBeNull();
    await store.putHints('aa', { name: 'a.hints', text: 'fugloy-hints 1\n' });
    await store.putPrefs('aa', { machine: 1, dos: 'ldos' });
    expect((await store.getHints('aa'))?.text).toBe('fugloy-hints 1\n');
    expect(typeof (await store.getHints('aa'))?.savedAt).toBe('number');
    expect(await store.getPrefs('aa')).toEqual({ machine: 1, dos: 'ldos' });
    expect(await store.allHints()).toEqual([{ hash: 'aa', name: 'a.hints', text: 'fugloy-hints 1\n' }]);
    await store.deleteProgram('aa');
    expect(await store.getHints('aa')).toBeUndefined();
    expect(await store.getPrefs('aa')).toBeUndefined();
  });

  it('openStore returns null when indexedDB is undefined', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error simulating a private window
    delete globalThis.indexedDB;
    try {
      expect(await openStore()).toBeNull();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});

describe('carry-over between builds (Review Focus 3)', () => {
  const hints = ex('sea-dragon/seadrg01.hints').toString('utf8');
  const saved = [{ hash: sea('seadrg01.cmd').hash, name: 'seadrg01.hints', text: hints }];

  it('seadrg01 hints pair with seadrg02 (its one block is identical) and are offered', () => {
    const s = sea('seadrg02.cmd');
    expect(s.hash).not.toBe(saved[0]!.hash);
    const direct = applyHints(parseHints(hints).file, s.module.image, s.hash, s.normalize);
    expect(direct.matched).toHaveLength(1);
    expect(direct.unmatched).toHaveLength(0);
    const best = bestCarryOver(s, saved);
    expect(best?.name).toBe('seadrg01.hints');
    expect(best?.matched).toBe(1);
  });

  it('seadrg01 hints do not pair with seadrg03, so nothing is offered', () => {
    expect(bestCarryOver(sea('seadrg03.cmd'), saved)).toBeNull();
  });

  it('offers a file even when it has lines that do not parse, and says so (not silently skipped)', () => {
    const broken = `${hints.trimEnd()}\nblock 0:$0010 frobnicate\nblock 1 length $0010 hash 0123456789abcdef\nblock 1:$0000 name GHOST\n`;
    const best = bestCarryOver(sea('seadrg02.cmd'), [{ hash: 'x', name: 'broken.hints', text: broken }]);
    expect(best).not.toBeNull();
    expect(best!.matched).toBe(1);
    expect(best!.unmatched).toBe(1);
    expect(best!.problems).toHaveLength(1);
    expect(best!.problems[0]).toMatch(/^line \d+: /);
  });

  it('a hint file never offers itself to its own program', () => {
    expect(bestCarryOver(sea('seadrg01.cmd'), saved)).toBeNull();
  });

  it('with one more block that nothing matches, the matched block applies and the other is listed, not dropped', () => {
    // Real seadrg01 hints plus a second, synthetic block that no Sea Dragon build has.
    const extra = `${hints.trimEnd()}\nblock 1 length $0010 hash 0123456789abcdef\nblock 1:$0000 name GHOST\n`;
    const s = sea('seadrg02.cmd');
    const best = bestCarryOver(s, [{ hash: 'x', name: 'two.hints', text: extra }]);
    expect(best?.matched).toBe(1);
    expect(best?.blocks).toBe(2);
    const file = parseHints(extra).file;
    const a = applyHints(file, s.module.image, s.hash, s.normalize);
    expect(a.matched).toHaveLength(1);
    expect(a.unmatched.map((u) => u.block.index)).toEqual([1]);
    expect(a.unmatched[0]!.hints).toBe(1);
    expect(writeHints(file)).toContain('GHOST');
  });
});

describe('hint-file drop', () => {
  const enc = (t: string): Uint8Array => new TextEncoder().encode(t);
  it('recognizes hint text by content, whatever the name', () => {
    expect(asHintText(enc(ex('sea-dragon/seadrg01.hints').toString('utf8')))).toContain('fugloy-hints 1');
  });
  it('still takes a hint file that does not parse, so its errors can be reported instead of loading it as binary', () => {
    expect(asHintText(enc('# mine\nfugloy-hints 1\nblock zero nonsense\n'))).toContain('nonsense');
    expect(asHintText(enc('fugloy-hints 9\n'))).not.toBeNull();
  });
  it('refuses programs, other text and empty files', () => {
    expect(asHintText(new Uint8Array(ex('sea-dragon/seadrg01.cmd')))).toBeNull();
    expect(asHintText(enc('hello world'))).toBeNull();
    expect(asHintText(new Uint8Array(0))).toBeNull();
  });
});
