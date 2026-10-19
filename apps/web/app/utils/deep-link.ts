// The workbench's deep link (phase 6B Task 7): `/?example=<id>&at=<4 hex digits>` opens a bundled
// game with its hints and puts the cursor on that run address, as a Learn lesson's In a real game
// box asks (`/?example=sea-dragon&at=4B9E`). The query then comes off the address bar, so a reload
// or a shared link of the page afterwards is the plain workbench. Anything else in the query, an
// unknown example, Armored Patrol (left out, as it is from Programs to try), or an `at` that is not four hex
// digits, does nothing. index.vue loads this module by dynamic import, and only when the page has
// a query, so it is never on the workbench's first screen.
import { isExampleId } from '../data/examples';
import type { Workbench } from '../composables/useWorkbench';

/** Opens the example the query names at its address; false, having done nothing, for any other query. */
export async function openDeepLink(search: string, wb: Workbench, go: (addr: number) => void): Promise<boolean> {
  const q = new URLSearchParams(search);
  const id = q.get('example');
  const at = q.get('at');
  if (id === null || !isExampleId(id) || id === 'armored-patrol') return false;
  if (at === null || !/^[0-9A-Fa-f]{4}$/.test(at)) return false;
  await wb.openExample(id);
  if (wb.example.value?.id !== id || wb.session.value === null) return false;
  go(parseInt(at, 16));
  history.replaceState(history.state, '', location.pathname + location.hash);
  return true;
}
