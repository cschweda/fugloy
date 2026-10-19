/** Types for rom.js, so the TypeScript packages' tests can read the ROMs fugloy.mcp.json names the way the emulator's tests do. */
export declare const ROM_TEST_TIMEOUT: number;
export declare function configPath(env?: Record<string, string | undefined>): string | null;
export declare function configuredRom(model?: 'model1' | 'model3' | 'model4', config?: string | null): Uint8Array | null;
export declare function configuredFixtures(pattern: RegExp, config?: string | null): string[];
