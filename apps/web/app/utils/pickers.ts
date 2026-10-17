// The top bar's machine and DOS pickers, and the raw-binary load address.
import { describeSelection } from '@fugloy/disasm';
import type { Dos, Machine, SymbolSelection } from '@fugloy/disasm';

export const MACHINES: readonly { machine: Machine; label: string }[] = [
  { machine: 1, label: 'Model I' },
  { machine: 3, label: 'Model III' },
  { machine: 4, label: 'Model 4' },
];

const DOSES: readonly Dos[] = ['trsdos', 'ldos', 'none'];
const DOS_LABEL: Readonly<Record<Dos, string>> = { trsdos: 'TRSDOS 1.3', ldos: 'LDOS 5.1', none: 'no DOS' };

function dosLabel(sel: SymbolSelection): string {
  // A Model 4 has no ROM tables; its one table is LS-DOS 6's service calls.
  return sel.machine === 4 ? 'LS-DOS 6 service calls' : DOS_LABEL[sel.dos];
}

/** The DOSes a machine has symbol tables for, as the library defines the pairs. */
export function dosChoices(machine: Machine): { dos: Dos; label: string }[] {
  return DOSES.filter((dos) => {
    try {
      describeSelection({ machine, dos });
      return true;
    } catch {
      return false;
    }
  }).map((dos) => ({ dos, label: dosLabel({ machine, dos }) }));
}

export function selectionLabel(sel: SymbolSelection): string {
  return `${MACHINES.find((m) => m.machine === sel.machine)?.label ?? `Model ${sel.machine}`} · ${dosLabel(sel)}`;
}

/** A load address typed as hex (`5200`, `$5200`, `0x5200`, `5200H`), from 0 to FFFF. */
export function parseBase(text: string): { base: number } | { error: string } {
  const m = /^(?:\$|0x)?([0-9a-f]{1,4})h?$/i.exec(text.trim());
  if (m === null) return { error: 'Type a hex address from 0 to FFFF, such as 5200.' };
  return { base: Number.parseInt(m[1]!, 16) };
}
