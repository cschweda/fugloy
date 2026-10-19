// Everything a Run needs, in one module that the Run composable loads by dynamic import the first
// time Run is pressed (plan 5B: asm and emu stay off the first screen). The Run tab's own
// components import the screen and keyboard modules directly; they are lazy too. 5C's running
// line, stepping, registers, and screen text come with it.
export { assemble, toCmd } from '@fugloy/asm';
export { prepareMachine, SentenceError } from './boot';
export { createRunner } from './runner';
export { stubRom } from './stub-rom';
export { romNotes, romSpaceCode, romUse } from './rom-use';
export { MODEL_NAMES } from './rom-ids';
export { runOnce, STUB_RUNNING } from './run-once';
export { lineAt, lineMarks, marksKey, trailOf, TRAIL_LINES, TRAIL_WINDOW } from './running';
export { breakAddress, createStepper, HALTED_INTERRUPTS_OFF, inactiveReason, stepOverTargets } from './stepping';
export { flagRows, readRegisters, registerRows } from './registers';
export { changedRows, screenAnnouncement, screenRows } from './screen-text';

export type RunKit = typeof import('./kit');
