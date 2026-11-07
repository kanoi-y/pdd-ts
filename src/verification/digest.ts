import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolveProjectPath } from './paths.js';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function digestFiles(root: string, paths: string[]): Promise<{ digest: string; files: Record<string, string> }> {
  if (paths.length === 0 || paths.length > 10000 || new Set(paths).size !== paths.length) {
    throw new Error('Digest inputs must be a nonempty unique bounded file set');
  }
  const files: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const relative of [...paths].sort()) {
    const file = await resolveProjectPath(root, relative);
    const info = await stat(file);
    if (!info.isFile() || info.size > 16_777_216) throw new Error(`Invalid or oversized verification input: ${relative}`);
    files[relative] = sha256(await readFile(file));
  }
  return { digest: sha256(JSON.stringify({ schema: 1, files })), files };
}
