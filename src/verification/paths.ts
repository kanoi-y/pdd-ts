import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function resolveProjectPath(root: string, relative: string, options: { allowMissing?: boolean } = {}): Promise<string> {
  if (!relative || /[\x00-\x1f\x7f]/.test(relative) || relative.includes('\\') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
      relative.split('/').includes('..') || path.posix.normalize(relative) !== relative || relative === '.') {
    throw new Error('Expected a canonical project-relative path');
  }
  const realRoot = await realpath(root);
  let current = realRoot;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not permitted in verification paths');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.allowMissing) throw error;
    }
  }
  if (!current.startsWith(realRoot + path.sep)) throw new Error('Path leaves project root');
  return current;
}
