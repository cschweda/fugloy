// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { flushOnLeave } from '../app/composables/usePersistence';

describe('flushOnLeave', () => {
  it('writes pending saves when the page is hidden (a tab switch, a phone app switch) and on pagehide, until removed', () => {
    let flushed = 0;
    const visibility = (state: 'hidden' | 'visible'): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const stop = flushOnLeave(window, document, () => void flushed++);
    visibility('visible');
    expect(flushed).toBe(0);
    visibility('hidden');
    expect(flushed).toBe(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(flushed).toBe(2);
    stop();
    visibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    expect(flushed).toBe(2);
  });
});
