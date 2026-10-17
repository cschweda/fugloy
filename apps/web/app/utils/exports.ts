// What Export ▾ downloads, as bytes. Pure: the menu does the Blob and the <a download>.
import { exportName, programFacts, renderSession, writeBasicCas, writeCmd, writeHints, writeSystemCas } from '@fugloy/disasm';
import type { Session } from '@fugloy/disasm';

export type ExportKind = 'zmac' | 'hints' | 'ir' | 'cmd' | 'cas';

export interface ExportResult {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  warnings: string[];
}

export const DOS_WARNING = 'calls the DOS; it will not run from tape';
export const LOW_WARNING = 'loads under $4200, over memory the ROM uses while loading a tape';

/** The opened file's name without its extension: `ARMOUR.III` is `ARMOUR`. */
export function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || 'program';
}

/** A `.BAS` program has no memory image to write as a load module. */
export function exportKinds(s: Session): ExportKind[] {
  const all: ExportKind[] = ['zmac', 'hints', 'ir', 'cmd', 'cas'];
  return s.module.format === 'bas' ? all.filter((k) => k !== 'cmd') : all;
}

/** Why a `.CAS` of this program may not run, one phrase per reason. Empty for a BASIC tape. */
export function casWarnings(s: Session): string[] {
  if (s.module.format === 'bas') return [];
  const out: string[] = [];
  if (programFacts(s.analysis).dosCalls.length > 0) out.push(DOS_WARNING);
  if (s.module.image.blocks.some((b) => b.start < 0x4200)) out.push(LOW_WARNING);
  return out;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

export function exportFile(s: Session, kind: ExportKind): ExportResult {
  const stem = stemOf(s.name);
  switch (kind) {
    case 'zmac':
      return { filename: `${stem}.z80`, mime: 'text/plain', bytes: text(renderSession(s, 'zmac')), warnings: [] };
    case 'hints':
      return { filename: `${stem}.hints`, mime: 'text/plain', bytes: text(writeHints(s.hintFile)), warnings: [] };
    case 'ir':
      return { filename: `${stem}.ir.json`, mime: 'application/json', bytes: text(renderSession(s, 'ir')), warnings: [] };
    case 'cmd': {
      if (s.module.format === 'bas') throw new Error('a .BAS program has no .CMD form');
      const bytes = writeCmd(s.module.image, { entry: s.analysis.transfer, name: exportName(s.module, s.name, 8) });
      return { filename: `${stem}.cmd`, mime: 'application/octet-stream', bytes, warnings: [] };
    }
    case 'cas': {
      const name = exportName(s.module, s.name, 6);
      if (s.module.format === 'bas') {
        return { filename: `${stem}.cas`, mime: 'application/octet-stream', bytes: writeBasicCas(s.bytes, name), warnings: [] };
      }
      const entry = s.analysis.entry;
      if (entry === null) throw new Error('no entry point');
      return { filename: `${stem}.cas`, mime: 'application/octet-stream', bytes: writeSystemCas(s.module.image, { entry, name }), warnings: casWarnings(s) };
    }
  }
}

/** Downloads with a Blob and an <a download>. Nothing is sent anywhere. */
export function download(f: ExportResult): void {
  const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
