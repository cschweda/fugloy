/**
 * Writes the synthetic disk images in test/unit/disk-samples.js to fixtures/synthetic/disk/. Run
 * by `pnpm fixtures`; test/unit/disk-image.test.js fails when a committed image differs from what
 * its writer produces.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DISK_SAMPLES } from '../test/unit/disk-samples.js';

const dir = fileURLToPath(new URL('../../../fixtures/synthetic/disk/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, { build }] of Object.entries(DISK_SAMPLES)) writeFileSync(`${dir}${name}`, build());
console.log(`wrote ${Object.keys(DISK_SAMPLES).length} synthetic disk images to ${dir}`);
