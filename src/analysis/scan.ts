import { constants } from 'node:fs';
import { open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Project, Node, SyntaxKind, ModuleKind, ModuleResolutionKind, ScriptTarget, ts, SymbolFlags } from 'ts-morph';
import type { CallExpression, SourceFile, FunctionDeclaration, ArrowFunction, FunctionExpression, MethodDeclaration } from 'ts-morph';
export interface ScanEvidence {
    column: number;
    file: string;
    line: number;
    sourceDigest: string;
}
export interface ScanCall {
    expression: string;
    status: 'confirmed' | 'unknown';
    targetId?: string;
    importSpecifier?: string;
    reason: string;
    evidence: ScanEvidence;
}
export interface ScanReturn {
    expression: string;
    statusArgument: string | null;
    inCatch: boolean;
    conditions: string[];
    evidence: ScanEvidence;
}
export interface ScanRoute {
    method: string;
    path: string;
    handlerId?: string;
    status: 'inferred';
    evidence: ScanEvidence;
}
export interface ScanFunction {
    id: string;
    name: string;
    async: boolean;
    exported: boolean;
    contracts: string[];
    calls: ScanCall[];
    returns: ScanReturn[];
    evidence: ScanEvidence;
}
export interface ScanIssue {
    code: string;
    file: string;
    message: string;
}
export interface ScanReport {
    schemaVersion: 1;
    kind: 'architecture-scan';
    sourceDigest: string;
    coverage: {
        complete: boolean;
        scope: string;
        excluded: string[];
    };
    inputs: {
        file: string;
        digest: string;
        bytes: number;
    }[];
    metadata: {
        packageName: string | null;
        dependencies: string[];
        scriptNames: string[];
        tsconfigObserved: boolean;
        entrypoints: {
            field: string;
            value: string;
        }[];
        testFiles: string[];
        ciFiles: string[];
    };
    modules: {
        file: string;
        imports: {
            specifier: string;
            resolution: 'local' | 'external-or-alias' | 'unresolved' | 'dynamic';
            target?: string;
            evidence: ScanEvidence;
        }[];
        topLevelCalls: ScanCall[];
    }[];
    functions: ScanFunction[];
    boundaries: ScanCall[];
    routes: ScanRoute[];
    candidates: {
        functionId: string;
        status: 'inferred';
        reasons: string[];
        limitations: string[];
    }[];
    issues: ScanIssue[];
}
type Fn = FunctionDeclaration | ArrowFunction | FunctionExpression | MethodDeclaration;
const isFn = (n: Node): n is Fn => Node.isFunctionDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n) || Node.isMethodDeclaration(n);
const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const excluded = ['.git', '.pdd', '.tools', 'node_modules', 'dist', 'build', 'coverage', '.next'];
const metadataNames = new Set(['README.md', 'package.json', 'tsconfig.json']);
const MAX_FILE = 1048576, MAX_TOTAL = 16777216, MAX_ENTRIES = 10000, MAX_FILES = 2000, MAX_NODES = 200000;
async function boundedText(file: string): Promise<Buffer> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error('not-file');
        if (info.size > MAX_FILE)
            throw new Error('file-size-limit');
        const chunks: Buffer[] = [];
        let total = 0;
        while (total <= MAX_FILE) {
            const buffer = Buffer.alloc(Math.min(65536, MAX_FILE + 1 - total));
            const r = await handle.read(buffer, 0, buffer.length, null);
            if (!r.bytesRead)
                break;
            total += r.bytesRead;
            if (total > MAX_FILE)
                throw new Error('file-size-limit');
            chunks.push(buffer.subarray(0, r.bytesRead));
        }
        return Buffer.concat(chunks, total);
    }
    finally {
        await handle.close();
    }
}
/** Static observation only. Never loads a tsconfig, module, build script or application. */
export async function scanProject(directory: string): Promise<ScanReport> {
    const root = await realpath(directory), issues: ScanIssue[] = [], files = new Map<string, string>(), inputs: ScanReport['inputs'] = [];
    let entries = 0, totalBytes = 0, stopped = false, observations = 0;
    const deadline = Date.now() + 15000;
    const issue = (code: string, file: string, message: string) => issues.push({ code, file, message });
    const within = (file: string): boolean => {
        if (stopped)
            return false;
        if (Date.now() > deadline) {
            issue('time-limit', file, '調査の時間制限を超えました。');
            stopped = true;
            return false;
        }
        return true;
    };
    const observe = (file: string): boolean => {
        if (!within(file))
            return false;
        if (++observations > 10000) {
            issue('fact-limit', file, '調査結果の項目数の上限を超えました。');
            stopped = true;
            return false;
        }
        return true;
    };
    async function walk(relative: string, depth: number): Promise<void> {
        if (stopped)
            return;
        if (depth > 32) {
            issue('depth-limit', relative, '調査する深さの上限を超えました。');
            return;
        }
        const folder = await opendir(path.join(root, relative));
        for await (const entry of folder) {
            if (!within(relative))
                break;
            if (++entries > MAX_ENTRIES) {
                issue('entry-limit', relative, '調査する項目数の上限を超えました。');
                stopped = true;
                break;
            }
            if (excluded.includes(entry.name) || entry.name.startsWith('.') && entry.name !== '.github')
                continue;
            if (relative === '.github' && entry.name !== 'workflows')
                continue;
            if (relative === '.github/workflows' && entry.isDirectory())
                continue;
            const file = relative ? relative + '/' + entry.name : entry.name;
            if (/[\x00-\x1f\x7f]/.test(file) || file.includes(String.fromCharCode(92)) || file.length > 1000) {
                issue('invalid-path', relative, '安全にソース位置を表せないパスを調査しません。');
                continue;
            }
            if (entry.isSymbolicLink()) {
                issue('symlink', file, 'シンボリックリンクは辿っていません。');
                continue;
            }
            if (entry.isDirectory()) {
                await walk(file, depth + 1);
                if (stopped)
                    break;
                continue;
            }
            if (!entry.isFile() || !(/\.(?:[cm]?ts|tsx)$/.test(entry.name) || relative === '' && metadataNames.has(entry.name) || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)))
                continue;
            if (inputs.length >= MAX_FILES) {
                issue('file-limit', file, '調査するファイル数の上限を超えました。');
                stopped = true;
                break;
            }
            try {
                const canonical = await realpath(path.join(root, file));
                if (canonical !== path.join(root, file))
                    throw new Error('changed-path');
                const bytes = await boundedText(canonical);
                if (totalBytes + bytes.length > MAX_TOTAL) {
                    issue('total-size-limit', file, '調査する合計バイト数の上限を超えました。');
                    stopped = true;
                    break;
                }
                totalBytes += bytes.length;
                inputs.push({ file, digest: digest(bytes), bytes: bytes.length });
                files.set(file, bytes.toString('utf8'));
            }
            catch (error) {
                issue(error instanceof Error && error.message === 'file-size-limit' ? 'file-size-limit' : 'unreadable', file, '通常ファイルとして制限内で読み取れませんでした。');
            }
        }
    }
    await walk('', 0);
    inputs.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
    const hashes = new Map(inputs.map(i => [i.file, i.digest]));
    const report: ScanReport = { schemaVersion: 1, kind: 'architecture-scan', sourceDigest: digest(JSON.stringify(inputs)), coverage: { complete: issues.length === 0, scope: '選択したディレクトリ内の通常のTS/TSX、ルートのREADME/package/tsconfig、.github/workflowsのYAML（ファイルの観測のみ）。実行時の動作や外部モジュールの内部は対象外。', excluded: [...excluded, 'ドットで始まる項目（.github/workflowsの明示例外を除く）', 'TS/TSXと許可したメタデータ以外'] }, inputs, metadata: { packageName: null, dependencies: [], scriptNames: [], tsconfigObserved: files.has('tsconfig.json'), entrypoints: [], testFiles: [...files.keys()].filter(file => /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?tsx?$/.test(file)), ciFiles: [...files.keys()].filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) }, modules: [], functions: [], boundaries: [], routes: [], candidates: [], issues };
    const packageText = files.get('package.json');
    if (packageText)
        try {
            const p = JSON.parse(packageText);
            if (p && typeof p === 'object') {
                report.metadata.packageName = typeof p.name === 'string' ? p.name.slice(0, 1000) : null;
                for (const key of ['dependencies', 'devDependencies'])
                    if (p[key] && typeof p[key] === 'object')
                        report.metadata.dependencies.push(...Object.keys(p[key]));
                if (p.scripts && typeof p.scripts === 'object')
                    report.metadata.scriptNames = Object.keys(p.scripts);
                report.metadata.dependencies = [...new Set(report.metadata.dependencies)].sort();
                const collect = (field: string, value: unknown, depth = 0): void => {
                    if (depth > 8 || report.metadata.entrypoints.length >= 100)
                        return;
                    if (typeof value === 'string')
                        report.metadata.entrypoints.push({ field: field.slice(0, 1000), value: value.slice(0, 1000) });
                    else if (value && typeof value === 'object')
                        for (const [k, v] of Object.entries(value))
                            collect(field + '.' + k, v, depth + 1);
                };
                for (const key of ['main', 'module', 'bin', 'exports'])
                    collect(key, p[key]);
            }
        }
        catch {
            issue('metadata-error', 'package.json', 'package.jsonをJSONとして読めません。');
        }
    const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true, compilerOptions: { noLib: true, module: ModuleKind.NodeNext, moduleResolution: ModuleResolutionKind.NodeNext, target: ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve } });
    const sources: SourceFile[] = [];
    for (const [file, text] of files)
        if (/\.(?:[cm]?ts|tsx)$/.test(file))
            sources.push(project.createSourceFile('/scan/' + file, text));
    sources.sort((a, b) => a.getFilePath() < b.getFilePath() ? -1 : 1);
    const relative = (s: SourceFile) => s.getFilePath().slice('/scan/'.length);
    const evidence = (n: Node): ScanEvidence => ({ file: relative(n.getSourceFile()), line: n.getStartLineNumber(), column: ts.getLineAndCharacterOfPosition(n.getSourceFile().compilerNode, n.getStart()).character + 1, sourceDigest: hashes.get(relative(n.getSourceFile()))! });
    const records = new Map<Fn, ScanFunction>(), declarations = new Map<object, ScanFunction>();
    let nodes = 0;
    for (const source of sources) {
        const file = relative(source);
        if (!within(file))
            break;
        if (project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length)
            issue('syntax-error', file, '構文エラーがあるため、構造の一部を確認できません。');
        const descendants = source.getDescendants();
        nodes += descendants.length;
        if (nodes > MAX_NODES) {
            issue('ast-limit', file, 'AST項目数の上限を超えました。');
            stopped = true;
            break;
        }
        for (const n of descendants.filter(isFn)) {
            if (!observe(file))
                break;
            const variable = n.getParentIfKind(SyntaxKind.VariableDeclaration), name = Node.isArrowFunction(n) || Node.isFunctionExpression(n) ? variable?.getName() ?? (Node.isFunctionExpression(n) ? n.getName() : undefined) ?? `callback@${n.getStartLineNumber()}` : n.getName() ?? `anonymous@${n.getStartLineNumber()}`;
            if (name.length > 1000) {
                issue('name-limit', file, '長すぎる宣言名を構造に反映できません。');
                continue;
            }
            const record: ScanFunction = { id: `${file}#${name}@${n.getStartLineNumber()}:${evidence(n).column}`, name, async: n.isAsync(), exported: Node.isFunctionDeclaration(n) ? n.isExported() : Boolean(variable?.getVariableStatement()?.isExported()), contracts: n.getLeadingCommentRanges().flatMap(c => c.getText().split('\n').filter(l => /\/\/@\s*(?:contract|requires|ensures|invariant)/.test(l))).map(s => s.slice(0, 4096)), calls: [], returns: [], evidence: evidence(n) };
            records.set(n, record);
            declarations.set(n.compilerNode, record);
            if (variable)
                declarations.set(variable.compilerNode, record);
            report.functions.push(record);
        }
    }
    function callRecord(call: CallExpression): ScanCall {
        const expr = call.getExpression(), item: ScanCall = { expression: expr.getText().slice(0, 256), status: 'unknown', reason: '実行時にどの処理を呼ぶかは確認していません。', evidence: evidence(call) };
        if (Node.isIdentifier(expr)) {
            let symbol = expr.getSymbol();
            if (symbol && (symbol.getFlags() & SymbolFlags.Alias))
                symbol = symbol.getAliasedSymbol();
            const target = symbol?.getDeclarations().map(d => declarations.get(d.compilerNode)).find(Boolean);
            if (target) {
                item.targetId = target.id;
                item.status = 'confirmed';
                item.reason = 'ASTの静的参照先です。実行時の到達性・置換の有無は未確認です。';
            }
        }
        const rootName = Node.isIdentifier(expr) ? expr : expr.getFirstDescendantByKind(SyntaxKind.Identifier);
        const imported = rootName?.getSymbol()?.getDeclarations().map(d => d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)).find(Boolean);
        if (imported && !item.targetId) {
            item.importSpecifier = imported.getModuleSpecifierValue();
            item.reason = 'importを介した呼び出し構文です。別名の解決や参照先の実装は未確認です。I/Oの実行や契約は未確認です。';
        }
        return item;
    }
    if (!stopped)
        for (const source of sources) {
            if (!within(relative(source)))
                break;
            const imports: ScanReport['modules'][number]['imports'] = [];
            for (const declaration of [...source.getImportDeclarations(), ...source.getExportDeclarations()]) {
                if (!observe(relative(source)))
                    break;
                const specifier = declaration.getModuleSpecifierValue();
                if (!specifier)
                    continue;
                const target = declaration.getModuleSpecifierSourceFile();
                if (specifier.startsWith('.')) {
                    if (target)
                        imports.push({ specifier, resolution: 'local', target: relative(target), evidence: evidence(declaration) });
                    else {
                        imports.push({ specifier, resolution: 'unresolved', evidence: evidence(declaration) });
                        issue('unresolved-import', relative(source), '相対importの参照先を確認できません。');
                    }
                }
                else
                    imports.push({ specifier, resolution: 'external-or-alias', evidence: evidence(declaration) });
            }
            const topLevelCalls: ScanCall[] = [];
            for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
                if (!observe(relative(source)))
                    break;
                const owner = call.getAncestors().find(isFn), record = callRecord(call);
                if (owner)
                    records.get(owner)?.calls.push(record);
                else
                    topLevelCalls.push(record);
                if (record.status === 'unknown')
                    report.boundaries.push(record);
                if (call.getExpression().getKind() === SyntaxKind.ImportKeyword)
                    imports.push({ specifier: call.getArguments()[0]?.getText().slice(0, 256) ?? '<unknown>', resolution: 'dynamic', evidence: evidence(call) });
            }
            for (const statement of source.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
                if (!observe(relative(source)))
                    break;
                const owner = statement.getAncestors().find(isFn);
                if (!owner)
                    continue;
                const record = records.get(owner);
                if (!record)
                    continue;
                const expr = statement.getExpression(), contexts = statement.getAncestors().slice(0, statement.getAncestors().indexOf(owner));
                const conditions = contexts.filter(Node.isIfStatement).map(item => `if (${item.getExpression().getText().slice(0, 256)}) の分岐内`);
                const statusArgument = expr && Node.isCallExpression(expr) && Node.isPropertyAccessExpression(expr.getExpression()) && expr.getExpression().getText().endsWith('.json') ? expr.getArguments()[1]?.getText().slice(0, 100) ?? null : null;
                record.returns.push({ expression: expr?.getText().slice(0, 500) ?? '', statusArgument, inCatch: contexts.some(Node.isCatchClause), conditions, evidence: evidence(statement) });
            }
            // Expression-bodied arrows have an implicit return, including common Hono handlers.
            for (const [fn, record] of records) {
                if (fn.getSourceFile() !== source || !Node.isArrowFunction(fn))
                    continue;
                const expr = fn.getBody();
                if (Node.isBlock(expr))
                    continue;
                if (!observe(relative(source)))
                    break;
                const statusArgument = Node.isCallExpression(expr) && Node.isPropertyAccessExpression(expr.getExpression()) && expr.getExpression().getText().endsWith('.json') ? expr.getArguments()[1]?.getText().slice(0, 100) ?? null : null;
                record.returns.push({ expression: expr.getText().slice(0, 500), statusArgument, inCatch: false, conditions: [], evidence: evidence(expr) });
            }
            for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
                if (!observe(relative(source)))
                    break;
                const expr = call.getExpression(), args = call.getArguments();
                if (!Node.isPropertyAccessExpression(expr) || !['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(expr.getName()) || !args[0] || !Node.isStringLiteral(args[0]))
                    continue;
                const handler = args.slice(1).find(isFn), record = handler && records.get(handler);
                report.routes.push({ method: expr.getName().toUpperCase(), path: args[0].getLiteralText().slice(0, 1000), ...(record ? { handlerId: record.id } : {}), status: 'inferred', evidence: evidence(call) });
            }
            report.modules.push({ file: relative(source), imports, topLevelCalls });
        }
    for (const [n, record] of records) {
        if (!stopped && n.getBody() && !record.async && !record.calls.length) {
            const reasons = ['非同期の宣言ではなく、関数内に呼び出し構文がありません。'];
            if (record.contracts.length)
                reasons.push('ソースに契約コメントがあります。');
            const limitations = ['構文上の候補です。純粋性・業務上の重要度・形式検証の適合性はまだ検査していません。'];
            if (n.getParameters().some(p => /\bnumber\b/.test(p.getTypeNode()?.getText() ?? '')))
                limitations.push('numberの数値意味論は現在の証明プロファイルでは非対応です。');
            report.candidates.push({ functionId: record.id, status: 'inferred', reasons, limitations });
        }
    }
    report.coverage.complete = issues.length === 0;
    return report;
}
