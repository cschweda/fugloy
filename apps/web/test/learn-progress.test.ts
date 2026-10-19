import { describe, expect, it } from 'vitest';
import { createProgress } from '../app/utils/learn/progress';
import { CHAPTERS, LESSONS } from './learn-items';
import { progressId } from '../app/utils/learn/page';

function fake(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}
const lessonText = (slug: string) => `original ${slug}`;

describe('lesson progress', () => {
  it('round-trips an edit through storage', () => {
    const s = fake();
    createProgress(lessonText, () => s).saveEdit('a', 'mine');
    expect(s.data.get('fugloy:learn:edit:a')).toBe('mine');
    expect(createProgress(lessonText, () => s).edit('a')).toBe('mine');
    expect(createProgress(lessonText, () => s).edit('b')).toBeNull();
  });

  it("removes the key when the saved text equals the lesson's own", () => {
    const s = fake();
    const p = createProgress(lessonText, () => s);
    p.saveEdit('a', 'mine');
    p.saveEdit('a', 'original a');
    expect(s.data.has('fugloy:learn:edit:a')).toBe(false);
    expect(p.edit('a')).toBeNull();
  });

  it('clearEdit removes an edit', () => {
    const s = fake();
    const p = createProgress(lessonText, () => s);
    p.saveEdit('a', 'mine');
    p.clearEdit('a');
    expect(p.edit('a')).toBeNull();
    expect(s.data.has('fugloy:learn:edit:a')).toBe(false);
  });

  it('markDone twice keeps one entry', () => {
    const s = fake();
    const p = createProgress(lessonText, () => s);
    p.markDone('a');
    p.markDone('a');
    expect(JSON.parse(s.data.get('fugloy:learn:done')!)).toEqual(['a']);
    expect([...createProgress(lessonText, () => s).done()]).toEqual(['a']);
  });

  it('answers from memory when every storage method throws', () => {
    const boom = () => { throw new Error('blocked'); };
    const s = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } as unknown as Storage;
    const p = createProgress(lessonText, () => s);
    p.saveEdit('a', 'mine');
    p.markDone('a');
    expect(p.edit('a')).toBe('mine');
    expect(p.done().has('a')).toBe(true);
    p.clearEdit('a');
    expect(p.edit('a')).toBeNull();
  });

  it('works when the storage accessor throws or returns null', () => {
    const p = createProgress(lessonText, () => { throw new Error('blocked'); });
    p.saveEdit('a', 'mine');
    expect(p.edit('a')).toBe('mine');
    const q = createProgress(lessonText, () => null);
    q.markDone('b');
    expect(q.done().has('b')).toBe(true);
  });

  it('reads corrupt done JSON as none', () => {
    const s = fake();
    s.setItem('fugloy:learn:done', '{');
    expect(createProgress(lessonText, () => s).done().size).toBe(0);
    s.setItem('fugloy:learn:done', '{"a":1}');
    expect(createProgress(lessonText, () => s).done().size).toBe(0);
  });

  it('keeps answers right when reads work but writes and removals throw', () => {
    const s = fake();
    s.data.set('fugloy:learn:edit:a', 'old');
    const boom = () => { throw new Error('quota'); };
    const ro = { ...s, getItem: s.getItem, setItem: boom, removeItem: boom } as unknown as Storage;
    const p = createProgress(lessonText, () => ro);
    expect(p.edit('a')).toBe('old');
    p.saveEdit('a', 'new');
    expect(p.edit('a')).toBe('new');
    p.clearEdit('a');
    expect(p.edit('a')).toBeNull();
    p.saveEdit('a', 'again');
    p.saveEdit('a', 'original a');
    expect(p.edit('a')).toBeNull();
  });

  // Review Focus 5: chapter 1 (01-blank-loop) and lesson 1 (01-white-out) never share a key.
  it('keys a chapter apart from a lesson: a chapter done or edited leaves the lesson as it was', () => {
    const s = fake();
    const chapter = progressId('invaders', '01-blank-loop');
    const lesson = progressId('lessons', '01-white-out');
    expect(chapter).toBe('invaders/01-blank-loop');
    expect(lesson).toBe('01-white-out');
    const programs = new Map([
      [chapter, CHAPTERS[0]!.program],
      [lesson, LESSONS[0]!.program],
    ]);
    const p = createProgress((id) => programs.get(id) ?? '', () => s);
    p.markDone(chapter);
    expect(p.done().has(chapter)).toBe(true);
    expect(p.done().has(lesson)).toBe(false);
    expect(p.done().has('01-blank-loop')).toBe(false);
    p.saveEdit(chapter, '; mine');
    expect(s.data.get('fugloy:learn:edit:invaders/01-blank-loop')).toBe('; mine');
    expect(p.edit(lesson)).toBeNull();
    // Saving the chapter's own text removes its edit: the chapter's program, not the lesson's.
    p.saveEdit(chapter, CHAPTERS[0]!.program);
    expect(p.edit(chapter)).toBeNull();
    p.saveEdit(lesson, CHAPTERS[0]!.program);
    expect(p.edit(lesson)).toBe(CHAPTERS[0]!.program);
  });
});
