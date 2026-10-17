/** Looking up a cited page in a manual's archive.org scan. No I/O. */
import type { ManualScan } from './types.js';

/** The 1-based PDF page that holds printed page `printed`, as a cite gives it, or null when the scan does not list it. */
export function manualPage(scan: ManualScan, printed: string): number | null {
  return Object.hasOwn(scan.pages, printed) ? scan.pages[printed]! : null;
}
