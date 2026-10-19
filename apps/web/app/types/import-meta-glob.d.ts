// Vite's `import.meta.glob`, in the eager form the Learn page's lessons use (utils/learn/lessons.ts).
// Nuxt's generated tsconfig does not load vite/client's types, so the form used is declared here.
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options: { eager: true; query?: string; import?: string }): Record<string, T>;
}
