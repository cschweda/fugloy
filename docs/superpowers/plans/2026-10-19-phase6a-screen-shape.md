# Phase 6A: the screen's true shape — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the Model I and the Model III at their real picture shapes, enlarged as far as the space allows, with a full-screen button, in Run ▶ (and so in the Learn page to come).

**Architecture:** `utils/emulator/screen.ts` gains each model's tube aspect, derived from the video timing in code, and a fit function that takes the available width and height; `TrsScreen.vue` binds the aspect and adds a full-screen control on the screen box.

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript strict, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-phase6-learn-assembly-design.md` (Part 0; Delivery, 6A)

## Global Constraints

- Model III and Model 4 (both sizes): aspect 4:3.
- Model I: aspect (4/3) × (384 / 10.6445 MHz) / (512 / 10.1376 MHz) ≈ 0.952, computed from those four numbers in code, with a comment citing 48k.ca "Beamhacking: Video Timing" (https://48k.ca/beamhack4.html) and MAME `src/mame/trs/trs80.cpp` (`set_raw(10.6445_MHz_XTAL, 672, 0, 384, 264, 0, 192)`) for the Model I and emu `models.js` (`clockHz: 2027520`, the 10.1376 MHz ÷ 5) for the Model III.
- Rows keep scaling by a whole number of screen pixels (5D's rule); across, the scale follows the aspect.
- Everything stays in the lazy Run chunk; the workbench's first screen stays within 252,775 B; `check:prefetch` passes.
- Commit messages: `p6: …`, imperative, one line, no AI trailer.

## Review Focus

1. A host narrower than one whole-row step (a phone-width panel): the tube still shows, at the host's width and the model's aspect, never overflowing. Test in Task 1.
2. Switching model while running (Model III → Model I): the tube's shape changes at once with no stale size. Test in Task 2 (e2e).
3. Full screen in a window shorter than it is wide, and taller than it is wide: the tube fits both dimensions, centred, whole rows. Test in Task 1 (the fit function) and Task 2 (e2e).
4. Leaving full screen (Esc, or the button again) returns the tube to its panel size and keeps the keyboard focus on the screen. Test in Task 2.
5. Keys typed while full screen reach the TRS-80 (the box keeps focus). Test in Task 2.

---

### Task 1: The aspect and the fit, in `screen.ts`

**Files:**
- Modify: `apps/web/app/utils/emulator/screen.ts` (replace `tubeWidth`)
- Test: `apps/web/test/screen.test.ts`

**Interfaces:**
- Produces:
  - `export const MODEL1_ASPECT: number` (≈ 0.952) and `export const MODEL3_ASPECT = 4 / 3`.
  - `export function tubeAspect(font: ScreenFont): number` — `MODEL1_ASPECT` for `'model1'` and `'model1-lowercase'`, else `MODEL3_ASPECT`.
  - `export function tubeFit(rasterHeight: number, aspect: number, availWidth: number, availHeight: number = Infinity): { width: number; height: number }` — the largest k ≥ 1 with `k × rasterHeight ≤ availHeight` and `k × rasterHeight × aspect ≤ availWidth`, giving `{ width: k × rasterHeight × aspect, height: k × rasterHeight }`; when no k ≥ 1 fits, the largest tube at `aspect` within both (`width = min(availWidth, availHeight × aspect)`, `height = width / aspect`).
  - `tubeWidth` is removed; its callers move to `tubeFit`.

- [ ] **Step 1: Write the failing tests:** `MODEL1_ASPECT` equals `(4/3) * (384/10.6445e6) / (512/10.1376e6)` and lies in (0.95, 0.955); `tubeAspect('model1-lowercase') === MODEL1_ASPECT`; `tubeAspect('model4') === 4/3`; `tubeFit(192, 4/3, 800)` → `{ width: 768, height: 576 }`; `tubeFit(192, MODEL1_ASPECT, 800, 600)` → height 576 (k = 3) and width 576 × MODEL1_ASPECT; `tubeFit(240, 4/3, 1000)` → `{ width: 960, height: 720 }`; height-bound: `tubeFit(192, 4/3, 2000, 500)` → height 384 (k = 2); Review Focus 1: `tubeFit(192, 4/3, 200)` → `{ width: 200, height: 150 }`; `tubeFit(192, MODEL1_ASPECT, 150, 100)` → height 100, width 100 × MODEL1_ASPECT.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/screen.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** in `screen.ts`, with the citing comment from Global Constraints.
- [ ] **Step 4: Run** the test — expect PASS; `pnpm --filter @fugloy/web typecheck` fails only in `TrsScreen.vue` (Task 2 fixes it) — so do Task 1 and Task 2 in one commit (Step 5 of Task 2).

### Task 2: The tube's shape and full screen in `TrsScreen.vue`

**Files:**
- Modify: `apps/web/app/components/run/TrsScreen.vue`
- Modify: `apps/web/test/e2e/run.spec.ts` or create `apps/web/test/e2e/screen-shape.spec.ts`
- Modify: `apps/web/app/pages/about.vue` only if it documents the screen's keys (add the full-screen control)

**Interfaces:**
- Consumes: Task 1's `tubeAspect`, `tubeFit`.
- Produces: the screen box's CSS `aspect-ratio` bound to `tubeAspect(view.font)` (no longer fixed at 4/3); a **Full screen** button (`data-testid="screen-fullscreen"`, text `Full screen` / `Leave full screen`, `aria-pressed`) in the machine row beside Pause (RunTab passes it through, or TrsScreen renders it — the builder picks one place); in full screen the screen box (`requestFullscreen` on it) is centred on black at `tubeFit(rasterHeight, aspect, innerWidth, innerHeight)`; `fullscreenchange` keeps the button's state and size right; the box keeps focus throughout.

- [ ] **Step 1: Write the failing e2e** (CI has no ROM: use the stub-ROM starter Run, which draws a Model III screen, and switch the source's model to Model I for the shape check):
  - the Model III tube's box measures 4:3 within 1 px; after switching to Model I and Running, the box's width ÷ height is within 0.01 of 0.952 (Review Focus 2);
  - clicking `screen-fullscreen` makes `document.fullscreenElement` the screen box, its height a whole multiple of 192 (or the viewport-fit fallback) and within the viewport; the screen keeps focus; a key typed then reaches the machine (`window.__fugloyTest` already exposes what the existing keyboard specs use) (Review Focus 3, 5);
  - pressing the button again (or `document.exitFullscreen()`) restores the panel size and leaves focus on the screen (Review Focus 4);
  - a 900×1200 viewport: in full screen the tube is width-bound and fits (Review Focus 3).
- [ ] **Step 2: Run** after `pnpm build`: `pnpm --filter @fugloy/web exec playwright test <spec>` — expect FAIL.
- [ ] **Step 3: Implement** the aspect binding, the fit (replacing `tubeWidth`), the button, and the full-screen styles; update the component's header comment to say exactly what is true now.
- [ ] **Step 4: Run** `pnpm test:web`, `pnpm --filter @fugloy/web typecheck`, the full `pnpm --filter @fugloy/web test:e2e`, `check:prefetch`, and `size:first-screen` on a plain `generate` — expect all pass, size within budget.
- [ ] **Step 5: Commit** `p6: draw each model at its true shape, with a full-screen button` (with Task 1's changes).

### Task 3: Record 6A

**Files:** `CHANGELOG.md` (Unreleased), `docs/Fugloy-Project-Plan.md` (phase 6's entry: 6A merged), `CLAUDE.md` (Current phase).

- [ ] **Step 1: Write** the entries (the shapes and their source, full screen, the size measured).
- [ ] **Step 2: Run** `pnpm typecheck && pnpm test:web` — expect PASS.
- [ ] **Step 3: Commit** `p6: record phase 6A`
