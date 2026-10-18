/**
 * Known Model III ROM images by SHA-256 (lowercase hex), so the Machine can report which ROM it
 * was given (spec §5: the core validates by length and a known-hash table). Hashes are facts
 * about the images; the images themselves are never committed or bundled.
 *
 * Source for both: github.com/kiwisincebirth/TRS-80-ROMS, folder test-roms/, hashed locally
 * 2026-10-17. `Model3-RevC-2EF8.bin` is the stock Model III Rev C ROM (14,336 bytes) and the
 * image the repository's fugloy.mcp.json names as roms.model3; `Model3-RevC-FreHD.bin` is the
 * same ROM patched to boot a FreHD hard-disk emulator.
 */
export const ROM_HASHES = Object.freeze({
  beeb3741175a8b8706cc384d5b2534ebf32e383662864054e5a0ce4d861a43bb: 'model3-rev-c-2ef8',
  ad6de30c6aece2d6a2243ee90a2959295d5c46b82650b27f46f1ecf8b34b2361: 'model3-rev-c-frehd',
});
