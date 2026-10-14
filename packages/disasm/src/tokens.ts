/**
 * Level II BASIC keyword tokens, bytes 80H..FBH in order, from the project
 * plan's appendix. Index 0 is 80H.
 */
export const TOKENS: readonly string[] = [
  'END', 'FOR', 'RESET', 'SET', 'CLS', 'CMD', 'RANDOM', 'NEXT', 'DATA', 'INPUT', 'DIM', 'READ', 'LET', 'GOTO', 'RUN', 'IF',
  'RESTORE', 'GOSUB', 'RETURN', 'REM', 'STOP', 'ELSE', 'TRON', 'TROFF', 'DEFSTR', 'DEFINT', 'DEFSNG', 'DEFDBL', 'LINE', 'EDIT', 'ERROR', 'RESUME',
  'OUT', 'ON', 'OPEN', 'FIELD', 'GET', 'PUT', 'CLOSE', 'LOAD', 'MERGE', 'NAME', 'KILL', 'LSET', 'RSET', 'SAVE', 'SYSTEM', 'LPRINT',
  'DEF', 'POKE', 'PRINT', 'CONT', 'LIST', 'LLIST', 'DELETE', 'AUTO', 'CLEAR', 'CLOAD', 'CSAVE', 'NEW', 'TAB(', 'TO', 'FN', 'USING',
  'VARPTR', 'USR', 'ERL', 'ERR', 'STRING$', 'INSTR', 'POINT', 'TIME$', 'MEM', 'INKEY$', 'THEN', 'NOT', 'STEP', '+', '-', '*',
  '/', '^', 'AND', 'OR', '>', '=', '<', 'SGN', 'INT', 'ABS', 'FRE', 'INP', 'POS', 'SQR', 'RND', 'LOG',
  'EXP', 'COS', 'SIN', 'TAN', 'ATN', 'PEEK', 'CVI', 'CVS', 'CVD', 'EOF', 'LOC', 'LOF', 'MKI$', 'MKS$', 'MKD$', 'CINT',
  'CSNG', 'CDBL', 'FIX', 'LEN', 'STR$', 'VAL', 'ASC', 'CHR$', 'LEFT$', 'RIGHT$', 'MID$', "'",
];

export const TOKEN_BYTES: ReadonlyMap<string, number> = new Map(TOKENS.map((t, i) => [t, 0x80 + i]));

export const TOKEN_DATA = 0x88;
export const TOKEN_REM = 0x93;
export const TOKEN_ELSE = 0x95;
export const TOKEN_APOSTROPHE = 0xfb;
/** First and last token bytes; FC..FF are not tokens. */
export const TOKEN_FIRST = 0x80;
export const TOKEN_LAST = 0xfb;
