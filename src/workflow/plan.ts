import type { SpecSnapshot } from '../requirements/snapshot.js';
import { loadProject } from '../requirements/project.js';
import { createSpecSnapshot } from '../requirements/snapshot.js';
import type { DecisionRegistry } from '../requirements/decisions.js';
import { markdownText as t } from '../reporter/text.js';
export interface DecisionPlan {
    schemaVersion: 1;
    kind: 'decision-plan';
    status: 'needs-development' | 'needs-human-decision' | 'no-open-decisions' | 'open-nonblocking';
    blocked: boolean;
    implementationPermission: 'not-established';
    specDigest: string;
    snapshotComplete: boolean;
    cards: {
        group: string;
        blocking: boolean;
        decisions: DecisionRegistry['items'];
    }[];
    developmentTasks: DecisionRegistry['items'];
    recordedAnswers: DecisionRegistry['items'];
    diagnostics: string[];
}
export async function planProject(root: string): Promise<DecisionPlan> {
    const project = await loadProject(root);
    const snapshot = await createSpecSnapshot(project);
    if (snapshot.workflow && snapshot.workflow.registry === null)
        throw new Error('Invalid decision registry');
    return decisionPlanFromSnapshot(snapshot);
}
export function decisionPlanFromSnapshot(snapshot: Pick<SpecSnapshot, 'workflow' | 'complete' | 'digest' | 'errors'> & {
    metadata?: SpecSnapshot['metadata'];
}): DecisionPlan {
    const missingRegistry = snapshot.metadata && (snapshot.metadata.requirements.length === 0 || snapshot.metadata.obligations.length === 0);
    const items = snapshot.workflow?.registry?.items ?? [];
    const groups = new Map<string, DecisionRegistry['items']>();
    for (const item of items.filter(i => i.kind === 'human-specification' && i.state === 'open')) {
        const entries = groups.get(item.group) ?? [];
        entries.push(item);
        groups.set(item.group, entries);
    }
    const blocked = items.some(i => i.mustResolve);
    return { schemaVersion: 1, kind: 'decision-plan', status: missingRegistry || snapshot.workflow?.registry === null ? 'needs-development' : blocked ? 'needs-human-decision' : !snapshot.complete ? 'needs-development' : groups.size ? 'open-nonblocking' : 'no-open-decisions', blocked, implementationPermission: 'not-established', specDigest: snapshot.digest, snapshotComplete: snapshot.complete, cards: [...groups].map(([group, decisions]) => ({ group, blocking: decisions.some(d => d.mustResolve), decisions })), developmentTasks: items.filter(i => i.kind !== 'human-specification' && i.state === 'open'), recordedAnswers: items.filter(i => i.state === 'answered'), diagnostics: [...snapshot.errors, ...(missingRegistry ? ['要件と必須検証を登録してください。初期化だけでは検証の準備は完了しません。'] : [])] };
}
export function renderDecisionPlan(plan: DecisionPlan): string {
    const lines = ['# 仕様判断の整理', '', '実装・検証に先立ち、登録した未決事項と開発側の作業を整理します。分類・提案・回答は作者の記録で、本人承認ではありません。', '', `- 状態：${plan.status === 'needs-human-decision' ? '人の仕様判断が必要（依存する検証は停止）' : plan.status === 'needs-development' ? '開発側の対応が必要' : plan.cards.length ? '後日確認する未決事項あり' : '登録された未決事項なし'}`, '- 実装許可：この出力では認証していません。空のQueueや回答欄だけで承認済みにしないでください。', '', '## 人が所有する仕様判断', ''];
    for (const card of plan.cards) {
        lines.push(`### 判断カード：${t(card.group)}`, '', `- ${card.blocking ? '先に決定が必要' : 'OPEN・後日確認'}`);
        for (const d of card.decisions) {
            lines.push(`- **${t(d.id)}：${t(d.question)}**`, `  - 推奨：${t(d.recommendation)}`, `  - 影響：${t(d.impact)}`, `  - 要件：${d.requirementIds.map(t).join('、')}`, ...d.alternatives.map(a => `  - 代替 ${t(a.label)}：${t(a.tradeoff)}`), `  - 根拠：${d.evidence.map(e => `${t(e.file)}:${e.line}`).join('、')}`);
        }
        lines.push('');
    }
    lines.push('## 開発側が調べる・実装すること', '', ...plan.developmentTasks.map(d => `- ${t(d.id)}：${t(d.question)}（${d.kind === 'fact' ? '事実の調査' : '実装作業'}）`), '', '## 記録された回答（本人認証は別）', '', ...plan.recordedAnswers.map(d => `- ${t(d.id)}：${t(d.answer ?? '')}`), '', '## 不足と次の対応', '', ...plan.diagnostics.map(d => '- ' + t(d)), '- 高リスクの未決事項は、先に期待する仕様を確認してください。既にある具体的なユーザーの許可を、毎回の確認で取り直す必要はありません。', '- 作者が回答を記録・反映しても、証拠の鮮度・本人レビュー・保護CIは通常どおり別に確認します。');
    return lines.join('\n') + '\n';
}
