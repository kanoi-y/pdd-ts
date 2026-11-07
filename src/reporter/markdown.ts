import type { ReviewPacket } from '../cli/runs.js';

export function markdownText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()|#!]/g, char => '\\' + char);
}
function artifactLink(relative: string): string {
  const prefix = relative.startsWith('.pdd/') ? '../' + relative.slice(5) : '../../' + relative;
  const url = prefix.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16))).join('/');
  return `[${markdownText(relative)}](${url})`;
}
export function renderMarkdown(packet: ReviewPacket): string {
  const lines = ['# PDD Review Packet', '', packet.origin==='ci' && packet.approval==='approved' ? '**AUTHENTICATED CI** — signature, exact-head human approval and current evidence checked.' : '**LOCAL TRIAL** — source checks are local; external approval and authenticated CI are pending.', '',
    '## 30-second summary', '', `- Gate: ${packet.gate.status.toUpperCase()}`,
    `- Required evidence satisfied: ${packet.gate.satisfied.length}; findings: ${packet.gate.findings.length}`,
    `- Approval: ${packet.approval}`, `- Source commit: ${packet.commit}${packet.dirty ? ' (working tree has changes)' : ''}`,
    `- Registered runtime boundaries: ${packet.boundaries.length}`, `- Run: ${packet.runId}`, `- Specification: ${packet.specDigest}`, '', '## Requirements', '',
    '| Requirement | Intent | Risk |', '|---|---|---|'];
  for (const requirement of packet.requirements) lines.push(`| ${markdownText(requirement.id + ': ' + requirement.title)} | ${markdownText(requirement.intent)} | ${requirement.risk} |`);
  lines.push('', '## Evidence', '', '| Obligation | Kind | Result | Scope | Assumptions |', '|---|---|---|---|---|');
  for (const evidence of packet.evidence) lines.push(`| ${markdownText(evidence.obligationId)} | ${evidence.kind} | ${evidence.status} | ${markdownText(evidence.scope)} | ${markdownText(evidence.assumptions.join(', '))} |`);
  lines.push('', '## Runtime trust boundaries', '',
    'External facts remain trusted; input validation and executed cases provide empirical evidence.',
    `Policy allowance: ${markdownText(packet.allowedAssumptions.join(', '))}`, '',
    '| Boundary | Callee scope | Callers | Validators | Required tests | Trust premise |', '|---|---|---|---|---|---|');
  for (const boundary of packet.boundaries) lines.push(`| ${[boundary.id,boundary.calleeScope,boundary.callerFiles.join(', '),boundary.validatorFiles.join(', '),boundary.testObligationIds.join(', '),boundary.assumption ?? 'No additional logical premise declared'].map(markdownText).join(' | ')} |`);
  lines.push('', '## Decisions, gaps and unverified scope', '');
  if(packet.origin==='local') lines.push('- Human specification approval and authenticated CI provenance are not established by this local report.');
  lines.push('- Review changed requirements, all premises and trusted boundaries; source proof does not establish the truth of an external identity.');
  for (const finding of packet.gate.findings) lines.push(`- ${markdownText((finding.obligationId ? finding.obligationId + ': ' : '') + finding.code + ' — ' + finding.message)}`);
  for (const id of packet.unverifiedRequirements) lines.push(`- Unverified requirement: ${markdownText(id)}`);
  for (const diagnostic of packet.diagnostics) for (const message of diagnostic.messages) lines.push(`- ${markdownText(diagnostic.obligationId + ': ' + message)}`);
  lines.push('', '## Evidence details', '', '- Source proof is conditional on the declared semantic profile and trusted toolchain; tests and trusted contracts are different evidence.');
  for (const evidence of packet.evidence) {
    lines.push('', `### ${markdownText(evidence.obligationId)}`, '', `- Source input digest: ${evidence.sourceDigest}`, `- Proof input digest: ${evidence.proofInputDigest}`, `- Toolchain digest: ${evidence.toolchainDigest}`);
    for (const artifact of evidence.artifactPaths) lines.push('- ' + artifactLink(artifact));
  }
  return lines.join('\n') + '\n';
}
