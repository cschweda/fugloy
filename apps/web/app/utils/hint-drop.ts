// Telling a dropped hint file from a program, by content (never the extension).

/**
 * The text of a dropped file if it is a hint file: UTF-8 text whose first line that is not a
 * comment is the `fugloy-hints` header. Whether it parses is for the caller to report, so a
 * hint file with a mistake in it is still a hint file, not a program to load as raw binary.
 */
export function asHintText(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /^\s*(#[^\n]*\n\s*)*fugloy-hints\b/.test(text) ? text : null;
}
