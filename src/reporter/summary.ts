import type { ReviewPacket } from '../cli/runs.js';

export interface ReviewAction { subject:string; reason:string; next:string }
export interface ConfirmedBehavior { subject:string; claims:string[]; conditions:string[]; testScopes:string[] }
export interface ReviewSummary {
 stage:'needs-development'|'needs-spec-review'|'verified-ci';
 actions:ReviewAction[];
 confirmed:ConfirmedBehavior[];
}

/** Explain validated results; never infer business meaning from a machine identifier. */
export function summarizeReview(packet:ReviewPacket):ReviewSummary {
 const actions:ReviewAction[]=[];
 const subject=(id?:string):string=>{
  const ids=packet.obligations.find(item=>item.id===id)?.requirementIds??[];
  return packet.requirements.filter(item=>ids.includes(item.id)).map(item=>item.title).join('／')||'検証全体';
 };
 const unknownTrust=packet.boundaries.filter(item=>item.assumption&&!packet.allowedAssumptions.includes(item.assumption));
 for(const boundary of unknownTrust) actions.push({
  subject:packet.requirements.filter(item=>item.trustedBoundaries.includes(boundary.id)).map(item=>item.title).join('／')||'外部との接続',
  reason:'外部の情報・処理を信用する条件に、許可されていない前提があります。',
  next:'開発側が変更内容・必要性・影響を説明し、元の条件へ戻すか、具体的な仕様判断として提示します。識別子から意味を推測して承認を求めません。',
 });
 for(const finding of packet.gate.findings) {
  if(finding.code==='unapproved') continue;
  if(finding.code==='spec-incomplete'&&unknownTrust.some(item=>finding.message===`Unapproved boundary assumption: ${item.id}`)) continue;
  const item=packet.evidence.find(item=>item.obligationId===finding.obligationId);
  let reason:string,next:string;
  switch(finding.code) {
   case 'missing':reason='必要な検証結果がありません。';next='開発側が必須の検証を実行し、現在のコードに対応する結果を揃えます。';break;
   case 'unsatisfied':
    reason=item?.kind==='test'?'必須テストの結果を、揃った検証として確認できません。':item?.kind==='source-proof'?'関数の契約について、成功と確認できる証明結果がありません。':'必要な検証が成功したと確認できません。';
    next=item?.kind==='test'?'開発側が必要なテストと実行結果を照合し、不足・失敗・未実行の理由を解消して再実行します。':'開発側が検証の診断を調べ、意図した仕様を弱めずに実装や検証の不備を修正します。';break;
   case 'stale':reason='現在のコードや仕様と、検証結果が対応していません。';next='開発側が現在の対象で検証し直します。古い成功結果は流用しません。';break;
   case 'unauthenticated-run':reason='CIの出所を確認できていません。';next='開発側が信頼するCIで実行し、署名と対象コードを照合します。';break;
   case 'incomplete-proof':reason='必要な関数・契約を証明したという結果が揃っていません。';next='開発側が証明対象と実際の結果を照合し、不足する検証を実行します。';break;
   case 'scope-mismatch':case 'unexpected-evidence':reason='検証結果の対象が、必要と登録した対象と一致していません。';next='開発側が対象の対応を修正し、正しい対象で再検証します。';break;
   case 'duplicate':case 'duplicate-evidence-id':reason='同じ検証に複数の結果があり、採用すべき結果を一意に確認できません。';next='開発側が結果の重複を解消します。都合のよい成功だけを選びません。';break;
   case 'empty-obligations':case 'uncovered-requirement':reason='何を必須として検証するかの登録が足りません。';next='開発側が要件に必要な検証を登録して実行します。';break;
   case 'spec-incomplete':reason='仕様や外部との接続条件に、未解決の登録・説明の不備があります。';next='開発側が参照と前提を調べ、内容・影響を説明できる状態に整えます。';break;
   default:reason='検証の記録や設定を、合格の根拠として確認できません。';next='開発側が詳細の診断を調べ、原因を説明してから修正・再検証します。';
  }
  actions.push({subject:subject(finding.obligationId),reason,next});
 }
 if(!packet.snapshotComplete&&!actions.some(item=>item.reason.includes('仕様'))) actions.push({subject:'仕様の登録',reason:'仕様の抽出・参照が未完了です。',next:'開発側が仕様とコードの対応を整えます。'});
 if(packet.unverifiedRequirements.length&&!packet.gate.findings.some(item=>item.code==='uncovered-requirement')) actions.push({subject:'検証されていない要件',reason:'必要な検証との対応がありません。',next:'開発側が要件に対応する必須検証を登録して実行します。'});
 if(packet.dirty) actions.push({subject:'レビュー対象のコード',reason:'未コミットの変更が含まれています。',next:'開発側が変更をコミットし、その対象で検証し直してからレビューを依頼します。'});
 if(packet.gate.status==='blocked'&&!actions.length&&!packet.gate.findings.some(item=>item.code==='unapproved')) actions.push({subject:'検証全体',reason:'必要な条件を満たしたという判定がありません。',next:'開発側が詳細の結果と設定を照合します。'});
 const explainedScopes=new Map<string,string[]>();
 if(packet.snapshotComplete) for(const proof of packet.evidence.filter(item=>item.kind==='source-proof'&&item.status==='passed'&&packet.gate.satisfied.includes(item.obligationId))) {
  if(explainedScopes.has(proof.scope)) continue;
  const source=packet.sourceContracts.find(item=>item.scope===proof.scope)?.declaration;
  const descriptions=source?.requires.map((_,index)=>packet.requirements.flatMap(item=>item.contracts).find(contract=>
   contract.kind==='precondition'&&contract.sourceRef.clause==='requires'&&contract.sourceRef.index===index&&`${contract.sourceRef.file}#${contract.sourceRef.symbol}`===proof.scope)?.human);
  if(!source||!descriptions||descriptions.some(value=>value===undefined)) {
   actions.push({subject:subject(proof.obligationId),reason:'証明に用いた入力条件の説明が揃っていません。',next:'開発側がソースに書かれたすべての入力条件を確認し、未参照の条件も含めて説明を登録します。それまでは確認済みの振る舞いとして提示しません。'});
  } else explainedScopes.set(proof.scope,descriptions as string[]);
 }
 const confirmed:ConfirmedBehavior[]=[];
 for(const requirement of packet.snapshotComplete?packet.requirements:[]) {
  const accepted=packet.evidence.filter(item=>item.requirementIds.includes(requirement.id)&&item.status==='passed'&&packet.gate.satisfied.includes(item.obligationId));
  const proofIds=new Set(accepted.filter(item=>item.kind==='source-proof'&&explainedScopes.has(item.scope)).flatMap(item=>{
   const obligation=packet.obligations.find(entry=>entry.id===item.obligationId&&entry.kind===item.kind&&entry.scope===item.scope);
   return item.verifiedContractIds.filter(id=>obligation?.contractIds.includes(id));
  }));
  const contracts=requirement.contracts.filter(item=>proofIds.has(item.id));
  const claims=contracts.filter(item=>item.kind!=='precondition').map(item=>item.human);
  const conditions=[...new Set(accepted.filter(item=>item.kind==='source-proof').flatMap(item=>explainedScopes.get(item.scope)??[]))];
  const testScopes=accepted.filter(item=>item.kind==='test').map(item=>item.scope);
  if(claims.length||testScopes.length) confirmed.push({subject:requirement.title,claims,conditions,testScopes});
 }
 const stage=actions.length?'needs-development':packet.gate.status==='passed'&&packet.origin==='ci'&&packet.approval==='approved'?'verified-ci':'needs-spec-review';
 return {stage,actions,confirmed};
}
