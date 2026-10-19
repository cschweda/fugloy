// @vitest-environment happy-dom
// The workbench's deep link (phase 6B Task 7): /?example=sea-dragon&at=4B9E opens the game with its
// hints and moves the cursor there; anything else is left alone. And each lesson's In a real game
// box names a label the listing really has at its address.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkbench } from '../app/composables/useWorkbench';
import { openDeepLink } from '../app/utils/deep-link';
import { LESSONS } from './learn-items';
import { gameLink } from '../app/utils/learn/page';

// A path, not new URL(): under happy-dom, URL is the DOM's, which fileURLToPath refuses.
const examplesDir = (path: string): string => join(dirname(fileURLToPath(import.meta.url)), '../../../examples', path);
const readExample = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(readFileSync(examplesDir(path)));
  } catch {
    return null;
  }
};

describe('openDeepLink', () => {
  let replace: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    window.history.replaceState(null, '', '/?example=sea-dragon&at=4B9E#x');
    replace = vi.spyOn(window.history, 'replaceState');
  });
  afterEach(() => replace.mockRestore());

  it('opens Sea Dragon with its hints, moves the cursor to the address, and takes the query off the URL', async () => {
    const wb = createWorkbench({ readExample });
    const go = vi.fn();
    expect(await openDeepLink('?example=sea-dragon&at=4B9E', wb, go)).toBe(true);
    expect(wb.example.value?.id).toBe('sea-dragon');
    expect(wb.session.value?.hintSource).toBe('seadrg01.hints');
    expect(go).toHaveBeenCalledWith(0x4b9e);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/#x');
  });

  it.each([
    ['a malformed address', '?example=sea-dragon&at=XYZ'],
    ['an address of five digits', '?example=sea-dragon&at=12345'],
    ['no address', '?example=sea-dragon'],
    ['an unknown example', '?example=nope&at=4B9E'],
    ['Armored Patrol', '?example=armored-patrol&at=4B9E'],
  ])('does nothing for %s', async (_why, search) => {
    const wb = createWorkbench({ readExample });
    const open = vi.spyOn(wb, 'openExample');
    const go = vi.fn();
    expect(await openDeepLink(search, wb, go)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(wb.session.value).toBeNull();
    expect(go).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('the lessons’ In a real game boxes', () => {
  const boxes = LESSONS.filter((l) => l.game !== null);

  it('link to the workbench at the run address, in four hex digits', () => {
    expect(gameLink({ example: 'sea-dragon', addr: 0x4b9e })).toBe('/?example=sea-dragon&at=4B9E');
    expect(gameLink({ example: 'sea-dragon', addr: 0x0a0 })).toBe('/?example=sea-dragon&at=00A0');
  });

  it('are on the lessons whose match is clear', () => {
    expect(boxes.map((l) => l.number)).toEqual([1, 3, 4, 5, 6, 7]);
  });

  it("each names the label Sea Dragon's annotated listing has at its address", async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    const labels = new Map<number, string>();
    for (const r of wb.rows.value) if (r.kind === 'label') labels.set(r.addr, r.name);
    for (const l of boxes) expect(`${l.slug}: ${labels.get(l.game!.addr)}`).toBe(`${l.slug}: ${l.game!.name}`);
  });
});
