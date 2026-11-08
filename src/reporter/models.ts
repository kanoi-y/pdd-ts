import type {ReviewPacket} from '../cli/runs.js';
import {markdownText} from './text.js';
const reasons={'simultaneous-execution':'同時二重実行','attempt-limit':'試行上限の超過','invalid-terminal':'完了後にも残る実行','deadlock':'非終端デッドロック'};
export function renderModels(packet:ReviewPacket):string{
 if(!packet.modelChecks?.length)return '';
 const lines=['## 有限状態モデルの検査','','モデルの検査はコード全体の証明ではありません。公平性は仮定せず、最終的な成功や外部副作用の一度だけの実行は検証しません。','', '```mermaid','stateDiagram-v2','  pending --> running: claim','  running --> completed: complete','  running --> failed: fail / crash + recover','  failed --> pending: retry (上限未満)','```','', '図はjob-queue-v1の概念図です。危険なread/startの分離やworker停止の詳細は実際の操作列で確認してください。'];
 for(const entry of packet.modelChecks){
  const r=entry.result,e=packet.evidence.find(e=>e.obligationId===entry.obligationId),current=Boolean(e?.status==='passed'&&packet.gate.satisfied.includes(entry.obligationId));
  lines.push('',`### ${markdownText(entry.obligationId)}`,'',`- 証拠の現在の状態：${markdownText(e?.status??'not-run')}。記録された検査結果：${r.status}。${current?'この有限モデルの登録された安全性・デッドロック検査は成功しました。':'現在の合格根拠にはできません。'}`,
   `- 対象：1ジョブ、${r.model.workers} worker、最大${r.model.maxAttempts}試行。幅優先探索、${r.explored.states}状態・${r.explored.transitions}遷移、到達深さ${r.explored.depth}。`,
   `- 探索上限：${r.model.limits.states}状態・深さ${r.model.limits.depth}・100,000遷移・1秒。全探索：${r.exhaustive?'完了':'未完了'}。公平性：なし。`,
   `- 終了理由：${markdownText(r.reason)}。`);
  if(r.violation)lines.push('',`**反例：${reasons[r.violation]}**`,'','| 順 | 操作 | worker | 状態 | 試行数 | 実行中worker |','|---|---|---|---|---|---|',...r.counterexample.map((step,i)=>`| ${i} | ${step.action} | ${step.worker??'—'} | ${step.state.phase} | ${step.state.attempts} | ${step.state.active.join(', ')||'なし'} |`));
 }
 return lines.join('\n');
}
export function renderRiskReview(packet:ReviewPacket):string{
 const high=packet.requirements.filter(r=>r.risk==='high');if(!high.length)return '';
 const atlas=packet.atlasUpdate;
 return ['## 高リスク変更のレビュー','','以下は確認作業の案内です。チェック済みの証拠や承認を表しません。',...high.map(r=>`- [ ] **${markdownText(r.title)}**：${markdownText(r.target.file)} の主要Diff・入力条件・失敗時の状態・認可/外部境界を確認する。`),'- [ ] モデル検査・ソース証明・実行したテスト・未検証の範囲を区別する。',atlas?`- [ ] Atlas差分：${atlas.status==='proposal'?`追加${atlas.files.added.length}・変更${atlas.files.changed.length}・削除${atlas.files.removed.length}ファイル。提案とコードの根拠を照合する。`:'調査不完全または範囲不一致。差分の確定を保留する。'}`:'- [ ] Atlas差分は未指定。比較が必要なら変更前のscan JSONを保存し、review --previous PROJECT_RELATIVE_SCAN_JSONで比較する。','- [ ] 意図が変わる未決事項はplanの仕様判断カードへ戻す。'].join('\n');
}
