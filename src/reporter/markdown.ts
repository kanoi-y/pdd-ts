import type { ReviewPacket } from '../cli/runs.js';
import { renderScanChanges } from '../analysis/atlas.js';
import { summarizeReview } from './summary.js';

export {markdownText} from './text.js';
import {markdownText} from './text.js';
function artifactLink(relative: string): string {
  const prefix = relative.startsWith('.pdd/') ? '../' + relative.slice(5) : '../../' + relative;
  const url = prefix.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16))).join('/');
  return `[${markdownText(relative)}](${url})`;
}
const block=(value:unknown):string=>'<pre>'+JSON.stringify(value,null,2).replace(/[\u202a-\u202e\u2066-\u2069]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0')).replace(/[&<>]/g,char=>`&#${char.charCodeAt(0)};`)+'</pre>';

export function renderMarkdown(packet: ReviewPacket): string {
  const summary=summarizeReview(packet);
  const lines=['# 検証結果と次にすること','','登録した要件をどこまで確認できたか、開発側の対応と人にお願いする仕様の確認をまとめた資料です。',''];
  if(summary.stage==='needs-development') lines.push('**現在の結論：開発側の対応が必要です。いまは人に承認をお願いする段階ではありません。**');
  else if(summary.stage==='verified-ci') lines.push('**現在の結論：登録した必須検証、本人承認、CIの出所の確認が完了しています。**');
  else lines.push('**現在の結論：仕様の確認が必要です。手元の検証が通っていても、本人承認と信頼するCIでの確認は別途必要です。**');
  lines.push('','## 何を確かめたい検証か','');
  if(!packet.requirements.length) lines.push('対象の要件が登録されていません。開発側が目的と検証対象を登録する必要があります。');
  for(const requirement of packet.requirements) lines.push(`- **${markdownText(requirement.title)}**：${markdownText(requirement.intent)}`);
  lines.push('','## 開発側が先に対応すること','');
  if(summary.actions.length) for(const action of summary.actions) lines.push(`- **${markdownText(action.subject)}**：${markdownText(action.reason)} ${markdownText(action.next)}`);
  else lines.push('この実行結果に、開発側へ差し戻す検証上の指摘はありません。');
  lines.push('','## 今回確認できた範囲','');
  if(!summary.confirmed.length) lines.push('現在の結果から、要件を確認できたと説明できる検証はありません。');
  for(const item of summary.confirmed) {
    lines.push(`- **${markdownText(item.subject)}**`);
    for(const claim of item.claims) lines.push(`  - 関数内の計算について、登録した契約「${markdownText(claim)}」を、関数に記述された入力条件と宣言済みの前提の下で形式検証しました。`);
    for(const condition of item.conditions) lines.push(`  - この確認の入力条件：${markdownText(condition)}`);
    if(item.testScopes.length) lines.push('  - この要件に登録されたテストが成功しています。確認できるのは、今回実行したケースです。');
  }
  lines.push('','形式証明が対象にするのは指定した関数と契約です。アプリ全体や、外部から渡される本人情報・サービスの応答の正しさを証明したことにはなりません。テストで確認できるのは実行したケースです。');
  lines.push('','## 人にお願いすること','');
  if(summary.stage==='needs-development') lines.push('現時点で承認は求めません。開発側が上の問題を解消し、必要な仕様判断があれば、内容・理由・影響を説明してから改めて依頼します。');
  else if(summary.stage==='verified-ci') lines.push('この対象についての本人承認は確認済みです。コードや仕様が変わった場合は、新しい対象に対する確認が必要です。');
  else lines.push('上に書いた振る舞いが、実現したい仕様でよいかを確認してください。仕様が違う場合は、期待する振る舞いを開発側へ伝えてください。承認は対象コミットに対する本人レビューで確認します。');
  if(packet.atlasUpdate)lines.push('',renderScanChanges(packet.atlasUpdate));
  lines.push('','<details>','<summary>対象コード・検証結果・前提・根拠ファイルを確認する</summary>','',
    `- 判定の記録：${packet.gate.status}`,
    `- 実行元：${packet.origin==='local'?'手元の検証（外部承認・CIの証拠ではありません）':'CIの監査結果'}`,
    `- 本人承認：${packet.approval}`,
    `- 対象コミット：${markdownText(packet.commit)}${packet.dirty?'（未コミットの変更あり）':''}`,
    `- 実行ID：${markdownText(packet.runId)}`,
    `- 現在の仕様のハッシュ：${markdownText(packet.specDigest)}`,
    `- 実行時の仕様のハッシュ：${markdownText(packet.recordedSpecDigest)}`,
    '', '### 要件と契約の完全な登録',block(packet.requirements),
    '', '### ソースから抽出した全契約（未参照の入力条件を含む）',block(packet.sourceContracts),
    '', '### 必須の検証項目',block(packet.obligations),
    ...(packet.atlasUpdate?['','### Atlas更新候補の記録',block(packet.atlasUpdate)]:[]),
    '', '### 判定・診断の原文',block({gate:packet.gate,diagnostics:packet.diagnostics,unverifiedRequirements:packet.unverifiedRequirements}),
    '', '### 実行時に信頼する境界と、許可された前提',
    '外部の情報や処理を正しいと仮定する箇所です。以下の登録自体は、その正しさを証明した結果ではありません。',
    block({boundaries:packet.boundaries,allowedAssumptions:packet.allowedAssumptions}),
    '', '### 検証結果と根拠ファイル','');
  for(const evidence of packet.evidence) {
    lines.push(`#### ${markdownText(evidence.obligationId)}`,'',block(evidence));
    for(const artifact of evidence.artifactPaths) lines.push('- '+artifactLink(artifact));
    lines.push('');
  }
  lines.push('</details>','');
  return lines.join('\n');
}
