import type { ScanChanges } from './changes.js';
import type { ScanReport, ScanEvidence, ScanFunction } from './scan.js';
import { markdownText } from '../reporter/text.js';
export interface AtlasFlow {
    name: string;
    status: 'inferred';
    statusArgument: string | null;
    functionId: string;
    steps: string[];
    evidence: ScanEvidence[];
    unknowns: string[];
}
export interface ArchitectureAtlas {
    status: 'as-is-proposal';
    flows: AtlasFlow[];
    documents: {
        overview: string;
        domainMap: string;
        runtimeFlows: string;
        stateInvariants: string;
        changeMap: string;
    };
}
const t = markdownText;
const cite = (e: ScanEvidence) => `${t(e.file)}:${e.line}`;
const limit = 30;
/** Generated As-Is observations and proposals, never approved requirements or proof. */
export function createAtlas(scan: ScanReport): ArchitectureAtlas {
    const notes = '確認済みは、読み取ったコードの構文と静的な参照だけです。推測は構造からの候補、未確認は実行時の挙動・外部の契約・業務上の正しさです。仕様の承認や品質の合格を意味しません。';
    const functions = new Map(scan.functions.map(f => [f.id, f]));
    const flows: AtlasFlow[] = [];
    for (const route of scan.routes) {
        const fn = route.handlerId ? functions.get(route.handlerId) : undefined;
        if (!fn)
            continue;
        const groups = new Map<string | null, typeof fn.returns>();
        for (const result of fn.returns) {
            const group = groups.get(result.statusArgument) ?? [];
            group.push(result);
            groups.set(result.statusArgument, group);
        }
        for (const [statusArgument, returns] of groups) {
            if (flows.length >= 3)
                break;
            flows.push({
                name: `${route.method} ${route.path}：${statusArgument === null ? '明示ステータスのない返却' : `第2引数 ${statusArgument} の応答`}候補`, status: 'inferred', statusArgument, functionId: fn.id,
                steps: [`ルート形式の登録（${route.method}）`, ...returns.map(r => `${r.inCatch ? 'catch内：' : ''}${r.conditions.join(' / ')} ${r.expression}`)],
                evidence: [route.evidence, ...returns.map(r => r.evidence)], unknowns: ['返却構文の近傍からの候補です。前段の呼び出し履歴、条件の評価順、到達性、正常・異常の業務上の意味は未確認です。', '第2引数がHTTPステータスとして扱われることは、フレームワークを実行して確認した事実ではありません。']
            });
        }
        if (flows.length >= 3)
            break;
    }
    if (!flows.length)
        for (const fn of scan.functions.filter(f => f.exported).slice(0, 3))
            flows.push({ name: `${fn.name}を入口とするフロー候補`, status: 'inferred', statusArgument: null, functionId: fn.id, steps: fn.calls.map(c => c.expression), evidence: [fn.evidence], unknowns: ['外部からの実際の呼び出し、呼び出し順、分岐の到達性、重要度は未確認です。'] });
    const header = ['# Architecture Atlas — 現状調査', '', notes, '', `- 調査の範囲：${t(scan.coverage.scope)}`, `- 読み取った入力：${scan.inputs.length}件／関数の宣言：${scan.functions.length}件`, `- 範囲内の調査：${scan.coverage.complete ? '完了' : '未完了（読み取れない対象や制限を含みます）'}`,
        `- 除外：${scan.coverage.excluded.map(t).join('、')}`, ''];
    const overview = [...header, '## 確認済みの構造', '', `- package名の記載：${scan.metadata.packageName ? t(scan.metadata.packageName) : '未記載'}`, `- import/exportを観測したモジュール：${scan.modules.length}件`, `- 外部・動的な呼び出し構文：${scan.boundaries.length}件。実際のI/Oと断定していません。`, '', '## 推測と未確認', '', '- 関数の重要度やドメインの責務は、コードだけから決定していません。', '- 設定・plugin・packageのスクリプト・アプリは実行していません。baseUrl/pathsの静的解決と、実行時の依存は別です。', '- コードが今そう書かれていることを、正しい業務仕様として承認しません。', scan.history ? '- 変更頻度は後述の限定したGit履歴の観測です。' : '- Git変更頻度は未調査です。必要な場合だけscan --historyを指定してください。', '', ...scan.issues.map(i => `- 未確認：${t(i.file)} — ${t(i.message)}（${t(i.code)}）`)];
    overview.push('', '## 設定・テスト・CIの観測', '', `- tsconfigのファイル：${scan.metadata.tsconfigObserved ? 'あり（baseUrl/paths以外の設定は適用していません）' : '未確認'}`, `- テストファイル候補：${scan.metadata.testFiles.length}件（命名からの推測）`, `- CIファイル：${scan.metadata.ciFiles.length}件（内容は実行・認証していません）`);
    for (const entry of scan.metadata.entrypoints.slice(0, 20))
        overview.push(`- packageの入口の記載 ${t(entry.field)}：${t(entry.value)}（実行時の入口は未確認）`);
    for (const file of scan.metadata.ciFiles.slice(0, 20))
        overview.push('- CIの根拠：' + t(file));
    overview.push('', '## tsconfigの限定した静的解決', '', `- 状態：${scan.configuration.status === 'applied' ? '限定設定を解析（宣言されたbaseUrl/pathsのみ静的参照へ適用）' : scan.configuration.status === 'absent' ? 'ルートtsconfigなし' : '未解決（設定を適用せず保留）'}`, ...scan.configuration.notes.map(n => '- ' + t(n)));
    for (const e of scan.configuration.evidence)
        overview.push('- 設定の根拠：' + cite(e));
    for (const item of scan.configuration.paths.slice(0, 20))
        overview.push(`- 別名 ${t(item.pattern)} → ${item.targets.map(t).join('、')}`);
    if (scan.history) {
        const h = scan.history;
        overview.push('', '## Git変更頻度（任意の調査）', '', `- 状態：${h.status === 'available' ? '履歴を観測' : h.status === 'incomplete' ? '不完全' : '取得できず'}`, `- 基準コミット：${h.head ?? '未確認'}`, `- 対象コミット：${h.commitCount}件／上限${h.limit}件`, `- 浅い履歴：${h.shallow === null ? '未確認' : h.shallow ? 'はい' : 'いいえ'}`, ...h.notes.map(n => '- ' + t(n)));
        for (const file of h.files.slice(0, 20))
            overview.push(`- ${t(file.file)}：${file.changes}コミットで変更`);
    }
    const moduleIds = new Map(scan.modules.slice(0, limit).map((m, i) => [m.file, `M${i}`]));
    const domain = ['# 構造と境界', '', notes, '', '## モジュール依存（静的なimport）', '', '```mermaid', 'flowchart LR'];
    if (!moduleIds.size)
        domain.push('  Empty["対象モジュールなし"]');
    for (const [file, id] of moduleIds)
        domain.push(`  ${id}["モジュール${[...moduleIds.keys()].indexOf(file) + 1}"]`);
    for (const m of scan.modules)
        for (const edge of m.imports)
            if (edge.target && moduleIds.has(m.file) && moduleIds.has(edge.target))
                domain.push(`  ${moduleIds.get(m.file)} --> ${moduleIds.get(edge.target)}`);
    domain.push('```', '', `図は先頭${limit}モジュールまでです。すべての観測結果はJSONに含まれます。図中の番号とソースの対応：`, '');
    for (const [file, id] of moduleIds)
        domain.push(`- ${id}：${t(file)}`);
    domain.push('', '## 外部・動的な境界候補（未確認）', '');
    for (const call of scan.boundaries.slice(0, limit))
        domain.push(`- ${cite(call.evidence)}：${t(call.expression)}${call.importSpecifier ? '／import元 ' + t(call.importSpecifier) : ''} — ${t(call.reason)}`);
    if (scan.boundaries.length > limit)
        domain.push(`- ほか${scan.boundaries.length - limit}件はJSONを参照してください。`);
    const runtime = ['# フローの候補', '', notes, '', '以下は静的構文から選んだ最大3件です。重要度の確定ではなく、正常・異常の実行順や到達性は未確認です。', ''];
    if (flows.length < 3)
        runtime.push(`確認できた候補は${flows.length}件です。不足分を架空のフローで補完していません。`, '');
    for (const [index, flow] of flows.entries()) {
        runtime.push(`## 候補${index + 1}：${t(flow.name)}`, '', '- 分類：推測', '- 根拠：' + flow.evidence.map(cite).join('、'), '', '### 観測した呼び出し・返却の構文（実行順の断定ではありません）', '');
        for (const step of flow.steps.slice(0, 30))
            runtime.push('- ' + t(step));
        runtime.push('', '### 未確認', '', ...flow.unknowns.map(n => '- ' + t(n)), '');
    }
    const invariants = ['# 契約・不変条件と検証候補', '', notes, '', '## ソースに記載された契約の候補（未承認）', ''];
    for (const fn of scan.functions.filter(f => f.contracts.length).slice(0, limit)) {
        invariants.push(`- ${t(fn.name)} — ${cite(fn.evidence)}`, ...fn.contracts.map(c => '  - ' + t(c)));
    }
    invariants.push('', '記載は業務上の正しさや実際の証明成功の根拠ではありません。採用する場合は、要件とソース契約を人が確認し、通常の検証と承認を行います。', '', '## 検証対象として調べる候補（推測）', '');
    for (const candidate of scan.candidates.slice(0, limit)) {
        const fn = functions.get(candidate.functionId)!;
        invariants.push(`- ${t(fn.name)} — ${cite(fn.evidence)}`, ...candidate.reasons.map(r => '  - 根拠：' + t(r)), ...candidate.limitations.map(r => '  - 未確認・制限：' + t(r)));
    }
    const change = ['# 変更の波及を調べる地図', '', notes, '', '## 静的な関数参照', ''];
    for (const fn of scan.functions.slice(0, limit))
        for (const call of fn.calls.filter(c => c.targetId)) {
            const target = functions.get(call.targetId!)!;
            change.push(`- ${t(fn.name)} → ${t(target.name)}：${cite(call.evidence)}`);
        }
    change.push('', '実行時の置換、DI、動的import、外部サービス、未解決の呼び出しは網羅していません。上の静的参照だけで変更の全影響を確定しないでください。');
    return { status: 'as-is-proposal', flows, documents: { overview: overview.join('\n') + '\n', domainMap: domain.join('\n') + '\n', runtimeFlows: runtime.join('\n') + '\n', stateInvariants: invariants.join('\n') + '\n', changeMap: change.join('\n') + '\n' } };
}
export function renderAtlas(atlas: ArchitectureAtlas): string { return Object.values(atlas.documents).join('\n---\n\n'); }
export function renderScanChanges(changes: ScanChanges): string {
    const lines = ['## Atlasの更新候補（調査データの比較）', ''];
    if (changes.status === 'incomplete')
        lines.push('調査が不完全または範囲が異なるため、追加・削除の候補を確定できません。');
    else {
        for (const [key, label] of [['added', '追加を観測'], ['removed', '観測しなくなったファイル'], ['changed', '内容が変わったファイル']] as const) {
            lines.push(`- ${label}：${changes.files[key].length}件`);
            for (const file of changes.files[key].slice(0, 20))
                lines.push('  - ' + t(file));
        }
        if (changes.suggestedDocuments.length)
            lines.push('', '開発側が構造図・フロー・契約候補・影響範囲の記述を見直す候補です。自動で仕様やAtlasを承認しません。');
    }
    lines.push('', ...changes.notes.map(n => '- ' + t(n)));
    return lines.join('\n') + '\n';
}
