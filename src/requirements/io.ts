import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { resolveProjectPath } from '../verification/paths.js';

export async function readProjectText(root: string, relative: string, limit = 1_048_576): Promise<string> {
  const file = await resolveProjectPath(root, relative);
  const info = await stat(file);
  if (!info.isFile() || info.size > limit) throw new Error(`Invalid or oversized file: ${relative}`);
  const text = await readFile(file, 'utf8');
  if (Buffer.byteLength(text) > limit) throw new Error(`File grew beyond size limit: ${relative}`);
  return text;
}
export async function readProjectYaml(root: string, relative: string): Promise<unknown> {
  const document = parseDocument(await readProjectText(root, relative), { uniqueKeys: true, strict: true, stringKeys: true, prettyErrors: false });
  if (document.errors.length || document.warnings.length) throw new Error(`Invalid YAML document: ${relative}`);
  return document.toJS({ maxAliasCount: 0 }) as unknown;
}
export async function writeProjectFile(root: string, relative: string, data: string, replace = false): Promise<void> {
  const file = await resolveProjectPath(root, relative, { allowMissing: true });
  await mkdir(path.dirname(file), { recursive: true });
  if (!replace) { await writeFile(file, data, { flag: 'wx', mode: 0o600 }); return; }
  const temporary = await resolveProjectPath(root, relative + '.' + randomUUID() + '.tmp', { allowMissing: true });
  await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
export const yamlText = (value: unknown): string => stringify(value);

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'bigint') throw new Error('Non-JSON specification value');
  return JSON.stringify(value);
}
