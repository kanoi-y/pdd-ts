import { createHash } from 'node:crypto';
import { runProcess } from '../verification/process.js';
export interface ScanHistory {
    status: 'available' | 'unavailable' | 'incomplete';
    head: string | null;
    commitCount: number;
    limit: number;
    truncated: boolean;
    shallow: boolean | null;
    commits: string[];
    files: {
        file: string;
        changes: number;
    }[];
    observationDigest: string | null;
    notes: string[];
}
const gitOptions = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.pager=cat', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'log.showSignature=false', '-c', 'diff.orderFile=/dev/null'];
const env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1' };
/** Optional, bounded local history. Git configuration must not launch helpers. */
export async function scanHistory(root: string, observedFiles: readonly string[]): Promise<ScanHistory> {
    const result: ScanHistory = { status: 'unavailable', head: null, commitCount: 0, limit: 100, truncated: false, shallow: null, commits: [], files: [], observationDigest: null, notes: ['対象ディレクトリに変更のあるfirst-parent履歴の最近100件と、その中で調査対象ファイルが変更されたコミット数です。未コミット変更・別ブランチ・除外ファイルの頻度、重要度や欠陥リスクは表しません。', '履歴はローカルGitの観測で、署名・所有者承認・証明の証拠ではありません。'] };
    const run = (args: string[]) => runProcess('git', [...gitOptions, ...args], { cwd: root, env, timeoutMs: 3000, maxOutputBytes: 1048576 });
    // Some older Git versions ignore GIT_NO_LAZY_FETCH. Refuse configured
    // promisor repositories before reading objects, and deny every transport.
    const partial = await run(['config', '--includes', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.promisor)$']);
    if (partial.status !== 'completed' || partial.exitCode !== 1) {
        result.notes.push('部分clone・promisor設定、またはGit設定を確認できないため、自動fetchを避けて履歴を調査しません。');
        return result;
    }
    const head = await run(['rev-parse', '--verify', 'HEAD']);
    if (head.status !== 'completed' || head.exitCode !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})\n?$/.test(head.stdout)) {
        result.notes.push('Git未導入・リポジトリ外・未コミット、または制限内で履歴を読めませんでした。');
        return result;
    }
    result.head = head.stdout.trim();
    const shallow = await run(['rev-parse', '--is-shallow-repository']);
    if (shallow.status === 'completed' && shallow.exitCode === 0 && /^(?:true|false)\n?$/.test(shallow.stdout))
        result.shallow = shallow.stdout.trim() === 'true';
    if (result.shallow === true) {
        result.status = 'incomplete';
        result.notes.push('浅い履歴の境界では親との差分が不明なため、頻度を算出しません。fetchは実行しません。');
        return result;
    }
    const log = await run(['log', result.head, '--first-parent', '--diff-merges=first-parent', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-notes', '--no-color', '--root', '--relative', '--format=%x00PDD_COMMIT:%H%x00', '--raw', '--no-abbrev', '-z', '-n', '101', '--', '.']);
    if (log.status !== 'completed' || log.exitCode !== 0 || result.shallow === null) {
        result.status = 'incomplete';
        result.notes.push('時間・出力量の制限またはGitエラーで、頻度を確定できませんでした。');
        return result;
    }
    const observed = new Set(observedFiles), counts = new Map<string, number>();
    let selected = false, expectingPath = false;
    let seenFiles = new Set<string>();
    const malformed = (): ScanHistory => {
        result.status = 'incomplete';
        result.commits = [];
        result.notes.push('履歴の構造を確認できないため、コミット数・頻度を保留しました。');
        return result;
    };
    // --raw -z has a metadata record followed by exactly one opaque pathname
    // (--no-renames). A filename is never examined as a commit/header token.
    for (const raw of log.stdout.split('\0')) {
        if (expectingPath) {
            if (!raw)
                return malformed();
            if (observed.has(raw) && !seenFiles.has(raw)) {
                seenFiles.add(raw);
                counts.set(raw, (counts.get(raw) ?? 0) + 1);
            }
            expectingPath = false;
            continue;
        }
        const token = raw.replace(/^\n/, '');
        if (!token)
            continue;
        const marker = /^PDD_COMMIT:([a-f0-9]{40}|[a-f0-9]{64})$/.exec(token);
        if (marker) {
            selected = result.commits.length < 100;
            if (!selected) {
                result.truncated = true;
                break;
            }
            if (result.commits.includes(marker[1]!))
                return malformed();
            result.commits.push(marker[1]!);
            seenFiles = new Set();
            continue;
        }
        if (selected && /^:[0-7]{6} [0-7]{6} (?:[a-f0-9]{40}|[a-f0-9]{64}) (?:[a-f0-9]{40}|[a-f0-9]{64}) [ADMTUXB]$/.test(token)) {
            expectingPath = true;
            continue;
        }
        return malformed();
    }
    if (expectingPath)
        return malformed();
    result.commitCount = result.commits.length;
    result.files = [...counts].map(([file, changes]) => ({ file, changes })).sort((a, b) => b.changes - a.changes || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    result.status = 'available';
    result.observationDigest = createHash('sha256').update(JSON.stringify({ head: result.head, commits: result.commits, files: result.files, shallow: result.shallow, truncated: result.truncated })).digest('hex');
    if (result.truncated)
        result.notes.push('101件目を検出したため、最近100件で打ち切っています。');
    if (result.shallow)
        result.notes.push('浅い履歴です。取得されていない過去の変更は含みません。');
    return result;
}
