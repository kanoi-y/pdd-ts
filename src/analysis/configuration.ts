import path from 'node:path';
import { ts } from 'ts-morph';
import type { ScanEvidence, ScanIssue } from './scan.js';
export interface ScanConfiguration {
    status: 'absent' | 'applied' | 'unresolved';
    files: string[];
    evidence: ScanEvidence[];
    baseUrl: string | null;
    paths: {
        pattern: string;
        targets: string[];
    }[];
    notes: string[];
}
export const isScanConfig = (file: string): boolean => /^tsconfig(?:[.-][A-Za-z0-9_-]+)*\.json$/.test(path.posix.basename(file));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function localPath(base: string, value: string): string {
    if (value.length > 1000 || /[\x00-\x1f\x7f\\]/.test(value) || value.startsWith('/') || /^[a-z]:/i.test(value))
        throw new Error('path');
    const result = path.posix.normalize(path.posix.join(base, value));
    if (result === '..' || result.startsWith('../') || result.split('/').some(p => p.startsWith('.') && p !== '.'))
        throw new Error('path');
    return result;
}
interface Effective {
    baseUrl?: string;
    paths?: Record<string, unknown>;
    pathsOrigin?: string;
}
/** Interpret JSONC as inert data. Only collected, project-local config files are visible. */
export function readScanConfiguration(files: ReadonlyMap<string, string>, hashes: ReadonlyMap<string, string>): {
    metadata: ScanConfiguration;
    compilerOptions: Pick<ts.CompilerOptions, 'baseUrl' | 'paths'>;
    issues: ScanIssue[];
} {
    const metadata: ScanConfiguration = { status: 'absent', files: [], evidence: [], baseUrl: null, paths: [], notes: ['ルートtsconfigのローカル継承とbaseUrl/pathsだけを静的参照へ適用します。設定スクリプトやpluginは実行しません。実行時の別名解決は未確認です。'] };
    const issues: ScanIssue[] = [];
    const visited = new Set<string>();
    const cache = new Map<string, Effective>();
    if (!files.has('tsconfig.json'))
        return { metadata, compilerOptions: {}, issues };
    const load = (file: string, stack: string[]): Effective => {
        if (stack.includes(file) || stack.length >= 8)
            throw new Error('inheritance');
        const cached = cache.get(file);
        if (cached)
            return cached;
        if (visited.size >= 100)
            throw new Error('inheritance');
        const text = files.get(file);
        if (text === undefined)
            throw new Error('missing');
        visited.add(file);
        const parsed = ts.parseConfigFileTextToJson(file, text);
        if (parsed.error || !record(parsed.config))
            throw new Error('jsonc');
        let effective: Effective = {};
        if (parsed.config.extends !== undefined) {
            const bases = typeof parsed.config.extends === 'string' ? [parsed.config.extends] : parsed.config.extends;
            if (!Array.isArray(bases) || bases.length > 8 || !bases.every(b => typeof b === 'string'))
                throw new Error('extends');
            for (const base of bases) {
                if (!base.startsWith('.'))
                    throw new Error('external');
                const target = localPath(path.posix.dirname(file), base.endsWith('.json') ? base : base + '.json');
                if (!isScanConfig(target))
                    throw new Error('nonstandard');
                effective = { ...effective, ...load(target, [...stack, file]) };
            }
        }
        const own = parsed.config.compilerOptions;
        if (own !== undefined && !record(own))
            throw new Error('options');
        if (record(own)) {
            if (own.baseUrl !== undefined) {
                if (typeof own.baseUrl !== 'string')
                    throw new Error('baseUrl');
                effective.baseUrl = localPath(path.posix.dirname(file), own.baseUrl);
            }
            if (own.paths !== undefined) {
                if (!record(own.paths))
                    throw new Error('paths');
                effective.paths = own.paths;
                effective.pathsOrigin = path.posix.dirname(file);
            }
        }
        cache.set(file, effective);
        return effective;
    };
    try {
        const effective = load('tsconfig.json', []);
        const base = effective.baseUrl ?? effective.pathsOrigin ?? '.';
        const paths: Record<string, string[]> = Object.create(null);
        const entries = Object.entries(effective.paths ?? {});
        if (entries.length > 100)
            throw new Error('paths-limit');
        for (const [pattern, targets] of entries) {
            if (!pattern || pattern.length > 256 || /[\x00-\x1f\x7f\\]/.test(pattern) || pattern.split('*').length > 2 || !Array.isArray(targets) || targets.length === 0 || targets.length > 10)
                throw new Error('paths');
            const normalized: string[] = [];
            for (const target of targets) {
                if (typeof target !== 'string' || target.split('*').length > 2)
                    throw new Error('target');
                normalized.push(localPath(base, target));
            }
            // Absolute virtual targets preserve pathsOrigin without enabling
            // baseUrl lookup for bare imports that do not match a paths entry.
            paths[pattern] = normalized.map(target => '/scan' + (target === '.' ? '' : '/' + target));
            metadata.paths.push({ pattern, targets: normalized });
        }
        metadata.status = 'applied';
        metadata.baseUrl = effective.baseUrl ?? null;
        return { metadata, compilerOptions: { ...(effective.baseUrl !== undefined ? { baseUrl: '/scan' + (base === '.' ? '' : '/' + base) } : {}), ...(entries.length ? { paths } : {}) }, issues };
    }
    catch {
        metadata.status = 'unresolved';
        metadata.paths = [];
        metadata.baseUrl = null;
        metadata.notes.push('設定の形式、継承、範囲または上限を確認できません。部分的な設定から別名の参照先を断定しません。');
        issues.push({ code: 'configuration-unresolved', file: 'tsconfig.json', message: 'tsconfigの限定した静的設定を解決できません。ローカル標準名の継承・baseUrl/pathsを確認してください。' });
        return { metadata, compilerOptions: {}, issues };
    }
    finally {
        metadata.files = [...visited].sort();
        metadata.evidence = metadata.files.map(file => ({ file, line: 1, column: 1, sourceDigest: hashes.get(file)! }));
    }
}
