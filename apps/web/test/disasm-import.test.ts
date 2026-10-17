import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProgram } from '@fugloy/disasm';

const example = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../public/examples/${path}`, import.meta.url))));

describe('web app consumes @fugloy/disasm from source', () => {
  it('opens public/examples/sea-dragon/seadrg01.cmd', () => {
    const program = openProgram(example('sea-dragon/seadrg01.cmd'));
    const module = program.module;
    if (module.format !== 'cmd') throw new Error(`expected a .CMD, got ${module.format}`);
    expect(module.entry).not.toBeNull();
    expect(module.records.length).toBeGreaterThan(0);
  });
});
