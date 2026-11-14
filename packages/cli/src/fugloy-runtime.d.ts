/**
 * The part of @fugloy/runtime (plain JavaScript, no declarations of its own) the CLI uses: the ROM
 * routines the runtime stands in for, whose names `fugloy port` gives port() (src/rom.js).
 */
declare module '@fugloy/runtime' {
  export function standins(model: 1 | 3): ReadonlyMap<number, { readonly name: string }>;
}
