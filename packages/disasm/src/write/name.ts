import type { Module } from '../ir.js';

/**
 * The name an export carries: the `.CMD` `05` name when it has no `{hh}`
 * escape, else the file name's stem upper-cased, letters and digits only,
 * cut to `max` (6 for SYSTEM tapes, 8 for `.CMD`).
 */
export function exportName(mod: Module, fileName: string, max: 6 | 8): string {
  const own = 'name' in mod ? mod.name : undefined;
  if (own && own.trim() !== '' && !/\{[0-9a-fA-F]{2}\}/.test(own)) return own.trim().slice(0, max);
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (stem || 'PROGRAM').slice(0, max);
}
