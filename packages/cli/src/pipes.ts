/**
 * Error codes that mean the reader of a pipe has gone: a closed pipe (EPIPE), a socket-pair
 * pipe torn down under the writer (ENOTCONN, ECONNRESET; Node's piped stdio on macOS), or a
 * write after Node destroyed the stream.
 */
const GONE: ReadonlySet<string> = new Set(['EPIPE', 'ENOTCONN', 'ECONNRESET', 'ERR_STREAM_DESTROYED']);

export const readerGone = (e: NodeJS.ErrnoException): boolean => e.code !== undefined && GONE.has(e.code);
