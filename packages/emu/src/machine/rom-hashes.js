/**
 * Known ROM images by SHA-256 (lowercase hex), so the Machine can report which ROM it was given
 * and refuse one given for the other model (spec §5: the core validates by length and a
 * known-hash table). Hashes are facts about the images; the images themselves are never committed
 * or bundled. Each name starts with its model (`model1-`, `model3-`); src/machine/models.js lists
 * which names each model runs.
 *
 * Source for all: github.com/kiwisincebirth/TRS-80-ROMS, folder test-roms/.
 * - `M1L2_1.2.bin` and `M1L2_1.3.bin` (12,288 bytes each): the Model I Level II ROM, versions 1.2
 *   and 1.3 (the repository's MODEL1.md: "Both 1.3 and 1.2 versions"), hashed 2026-10-18; 1.3 is
 *   the image the repository's fugloy.mcp.json names as roms.model1.
 * - `Model3-RevC-2EF8.bin` (14,336 bytes): the stock Model III Rev C ROM and the image named as
 *   roms.model3; `Model3-RevC-FreHD.bin` is the same ROM patched to boot a FreHD hard-disk
 *   emulator. Hashed 2026-10-17.
 */
export const ROM_HASHES = Object.freeze({
  '3cd3824d2ac2743750d2179951ed812794302b885ccb4f98aa2579b352c4b00e': 'model1-level2-1.2',
  '5515d95d7c19058400a2e91c6930bb557035db5ce093bd96fd017f795c346776': 'model1-level2-1.3',
  beeb3741175a8b8706cc384d5b2534ebf32e383662864054e5a0ce4d861a43bb: 'model3-rev-c-2ef8',
  ad6de30c6aece2d6a2243ee90a2959295d5c46b82650b27f46f1ecf8b34b2361: 'model3-rev-c-frehd',
});
