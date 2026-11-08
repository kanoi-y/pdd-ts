import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readProjectText } from '../requirements/io.js';
import type { ScanReport } from './scan.js';
const relative = z.string().min(1).max(1000).refine(p => !p.startsWith('/') && !/^[a-z]:/i.test(p) && !/[\x00-\x1f\x7f\\]/.test(p) && p.split('/').every(s => s !== '' && s !== '.' && s !== '..'));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.object({ file: relative, digest: hash, bytes: z.number().int().nonnegative().max(1048576) });
const fn = z.object({ id: z.string().min(1).max(4096), name: z.string().max(1000), evidence: z.object({ file: relative, line: z.number().int().positive(), column: z.number().int().positive(), sourceDigest: hash }) });
const baseline = z.object({ schemaVersion: z.literal(1), kind: z.literal('architecture-scan'), sourceDigest: hash, coverage: z.object({ complete: z.boolean(), scope: z.string(), excluded: z.array(z.string()) }), inputs: z.array(input).max(2000), functions: z.array(fn).max(10000) });
export type ScanBaseline = z.infer<typeof baseline>;
export interface ScanChanges {
    status: 'proposal' | 'incomplete';
    baselineDigest: string;
    currentDigest: string;
    files: {
        added: string[];
        removed: string[];
        changed: string[];
    };
    functionDeclarations: {
        added: {
            file: string;
            name: string;
        }[];
        removed: {
            file: string;
            name: string;
        }[];
    };
    suggestedDocuments: string[];
    notes: string[];
}
export async function readScanBaseline(root: string, file: string): Promise<ScanBaseline> {
    const result = baseline.parse(JSON.parse(await readProjectText(root, file, 16777216)));
    const sorted = [...result.inputs].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0).map(({ file, digest, bytes }) => ({ file, digest, bytes }));
    if (new Set(sorted.map(i => i.file)).size !== sorted.length || createHash('sha256').update(JSON.stringify(sorted)).digest('hex') !== result.sourceDigest)
        throw new Error('Scan baseline input digest is inconsistent');
    const byFile = new Map(sorted.map(i => [i.file, i.digest]));
    if (result.functions.some(f => byFile.get(f.evidence.file) !== f.evidence.sourceDigest || f.id !== `${f.evidence.file}#${f.name}@${f.evidence.line}:${f.evidence.column}`))
        throw new Error('Scan baseline function evidence is inconsistent');
    return result;
}
export function compareScans(before: ScanBaseline, after: ScanReport): ScanChanges {
    const result: ScanChanges = { status: 'incomplete', baselineDigest: before.sourceDigest, currentDigest: after.sourceDigest, files: { added: [], removed: [], changed: [] }, functionDeclarations: { added: [], removed: [] }, suggestedDocuments: [], notes: ['比較元はユーザーが指定した調査データです。過去の実行や署名を認証したものではありません。', 'これは観測した構造の更新候補です。振る舞いや仕様の意味的な変更、品質の合格を判定しません。'] };
    if (!before.coverage.complete || !after.coverage.complete || before.coverage.scope !== after.coverage.scope || JSON.stringify(before.coverage.excluded) !== JSON.stringify(after.coverage.excluded)) {
        result.notes.push('調査が不完全、または範囲が異なるため、追加・削除を確定せず差分候補を保留します。');
        return result;
    }
    const oldFiles = new Map(before.inputs.map(i => [i.file, i.digest])), newFiles = new Map(after.inputs.map(i => [i.file, i.digest]));
    result.files.added = [...newFiles.keys()].filter(f => !oldFiles.has(f)).sort();
    result.files.removed = [...oldFiles.keys()].filter(f => !newFiles.has(f)).sort();
    result.files.changed = [...newFiles.keys()].filter(f => oldFiles.has(f) && oldFiles.get(f) !== newFiles.get(f)).sort();
    const oldFunctions = new Map(before.functions.map(f => [`${f.evidence.file}#${f.name}`, { file: f.evidence.file, name: f.name }])), newFunctions = new Map(after.functions.map(f => [`${f.evidence.file}#${f.name}`, { file: f.evidence.file, name: f.name }]));
    result.functionDeclarations.added = [...newFunctions].filter(([key]) => !oldFunctions.has(key)).map(([, v]) => v);
    result.functionDeclarations.removed = [...oldFunctions].filter(([key]) => !newFunctions.has(key)).map(([, v]) => v);
    result.notes.push('関数の一覧は名前とファイルによる構文上の観測です。同名宣言・動的な置換・意味的な同一性は保証しません。');
    if (result.files.added.length + result.files.removed.length + result.files.changed.length)
        result.suggestedDocuments = ['overview.md', 'domain-map.md', 'runtime-flows.md', 'state-invariants.md', 'change-map.md'];
    result.status = 'proposal';
    return result;
}
