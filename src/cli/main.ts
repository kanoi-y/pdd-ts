#!/usr/bin/env node
import { compareScans,readScanBaseline } from '../analysis/changes.js';
import { renderScanChanges } from '../analysis/atlas.js';
import { createAtlas, renderAtlas } from '../analysis/atlas.js';
import { scanProject } from '../analysis/scan.js';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { initProject, loadProject } from '../requirements/project.js';
import { writeProjectFile } from '../requirements/io.js';
import { verifyProject, reportProject, gitIdentity, NoRunError } from './runs.js';
import { renderMarkdown } from '../reporter/markdown.js';
import { describeToolchain } from '../verification/toolchain.js';

import {validateBoundaries} from '../verification/boundaries.js';
import {doctorGitHub} from '../ci/doctor.js';
import {GhClient} from '../ci/github.js';
import {auditCI} from '../ci/audit.js';
import { approveProject } from '../ci/commands.js';

const args = process.argv.slice(2);
let root = process.cwd();
let json = args.includes('--json');
const clean = (message: string): string => message.replaceAll(root, '<project>').replace(/[\x00-\x1f\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 4000);
try {
  const parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
    project: { type: 'string', default: root }, json: { type: 'boolean', default: false },
    attestation:{type:'string'}, pr: {type:'string'}, baseline: {type:'string'},
    previous:{type:'string'},
    ci: { type: 'boolean', default: false }, run: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  root = path.resolve(parsed.values.project);
  json = parsed.values.json;
  const command = parsed.positionals[0] ?? 'help';
  if (parsed.positionals.length > 1) throw new Error('Unexpected positional arguments');
  if (parsed.values.ci && (command!=='audit' || !parsed.values.baseline || !parsed.values.pr || !parsed.values.attestation)) throw new Error('CI audit requires --baseline SHA --pr NUMBER --attestation PROJECT_RELATIVE_FILE');
  if ((parsed.values.pr || parsed.values.baseline) && !['approve','audit'].includes(command)) throw new Error('--pr and --baseline are only valid with approve');
  if(parsed.values.previous&&!['scan','report'].includes(command))throw new Error('--previous is only valid with scan or report');
  if (parsed.values.run && !['report', 'audit'].includes(command)) throw new Error('--run is only valid with report or audit');
  if (parsed.values.help || command === 'help') {
    const help = 'pdd-ts <init|doctor|verify|report|audit|approve|scan> [--project DIR] [--json]\nreport/audit: [--run ID]\nscan/report: [--previous PROJECT_RELATIVE_SCAN_JSON]\napprove: --pr NUMBER --baseline SHA\nLocal checks are trials; they do not establish protected CI approval.\n';
    process.stdout.write(json ? JSON.stringify({ help }) + '\n' : help);
  } else if (command === 'scan') {
    if(parsed.values.attestation) throw new Error('--attestation is only valid with CI audit');
    const result=await scanProject(root);
    const atlas=createAtlas(result);
    const changes=parsed.values.previous?compareScans(await readScanBaseline(root,parsed.values.previous),result):undefined;
    process.stdout.write(json?JSON.stringify({...result,atlas,...(changes?{changes}:{})},null,2)+'\n':renderAtlas(atlas)+(changes?'\n'+renderScanChanges(changes):''));
    if(!result.coverage.complete)process.exitCode=1;
  } else if (command === 'init') {
    await initProject(root);
    process.stdout.write(json ? JSON.stringify({ schemaVersion: 1, initialized: true, approval: 'pending' }) + '\n' : 'Initialized PDD configuration. Register requirements and obligations before verification.\n');
  } else if (command === 'doctor') {
    const checks: { name: string; status: string; message: string }[] = [];
    try {
      const project = await loadProject(root);
      checks.push({ name: 'configuration', status: 'ready', message: 'Project configuration and registry are valid' });
      const covered=new Set(project.obligations.flatMap(item=>item.requirementIds));
      const registered=project.requirements.length>0 && project.obligations.length>0 && project.requirements.every(item=>covered.has(item.id)) && project.obligations.every(item=>item.kind==='source-proof' || item.kind==='test' && project.config.testTargets.some(target=>target.obligationId===item.id)) && validateBoundaries(project).length===0;
      checks.push({name:'required-registry',status:registered?'ready':'insufficient',message:registered?'Nonempty required evidence and runtime boundaries registered':'Register a complete nonempty supported requirement/obligation set and its boundaries'});
      try {
        const tools = await describeToolchain(root, project.config.tools);
        checks.push({ name: 'toolchain', status: 'ready', message: `Pinned toolchain: ${tools.digest}` });
      } catch (error) { checks.push({ name: 'toolchain', status: 'error', message: clean(error instanceof Error ? error.message : 'Unavailable') }); }
      try { const identity=await gitIdentity(root); checks.push({ name: 'source', status: identity.dirty?'dirty':'ready', message: identity.dirty?'Commit current inputs for protected verification':'Clean Git source identity available' }); }
      catch (error) { checks.push({ name: 'source', status: 'error', message: clean(error instanceof Error ? error.message : 'Unavailable') }); }
      const github=project.config.github;
      if(github?.checkAppId) {
        const online=await doctorGitHub(new GhClient(root),github.repository,{context:github.checkContext,appId:github.checkAppId,minApprovals:github.minApprovals,...(github.repositoryId?{repositoryId:github.repositoryId}:{}),workflow:github.workflow});
        checks.push({name:'ci-protection',status:online.status,message:online.findings.join('; ') || 'Check issuer and review protection verified online; signer identity must still be verified per run'});
      } else checks.push({name:'ci-protection',status:github?'insufficient':'unconfigured',message:'External repository protection and required check issuer are not configured'});
    } catch (error) { checks.push({ name: 'configuration', status: 'error', message: clean(error instanceof Error ? error.message : 'Invalid') }); }
    process.stdout.write(json ? JSON.stringify({ schemaVersion: 1, protectedReady: checks.length>0 && checks.every(check=>check.status==='ready'), readinessScope:'configuration-only; current evidence and human approval are checked separately', checks }, null, 2) + '\n' : checks.map(check => `${check.name}: ${check.status} — ${check.message}`).join('\n') + '\n');
    if (checks.some(check => check.status === 'error')) process.exitCode = 2;
  } else if (command === 'approve') {
    if (!parsed.values.pr || !parsed.values.baseline) throw new Error('approve requires --pr NUMBER --baseline IMMUTABLE_SHA');
    const result = await approveProject(root, Number(parsed.values.pr), parsed.values.baseline);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  } else if (['verify', 'report', 'audit'].includes(command)) {
    const packet = parsed.values.ci ? await auditCI(root,parsed.values.baseline!,Number(parsed.values.pr),parsed.values.attestation!) : command === 'verify' ? await verifyProject(root) : await reportProject(root, parsed.values.run);
    if(parsed.values.previous)packet.atlasUpdate=compareScans(await readScanBaseline(root,parsed.values.previous),await scanProject(root));
    const markdown = renderMarkdown(packet);
    await writeProjectFile(root, `.pdd/reports/${packet.runId}.md`, markdown, true);
    await writeProjectFile(root, `.pdd/reports/${packet.runId}.json`, JSON.stringify(packet, null, 2) + '\n', true);
    process.stdout.write(json ? JSON.stringify(packet, null, 2) + '\n' : markdown);
    process.exitCode = command === 'verify' && packet.evidence.some(item => item.status === 'error') ? 2 : packet.gate.status === 'blocked' ? 1 : 0;
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  const message = clean(error instanceof Error ? error.message : 'PDD operation failed');
  process.stdout.write(json ? JSON.stringify({ schemaVersion: 1, error: message, gate: { status: 'blocked' }, evidence: [], approval: 'pending' }) + '\n' : `PDD error: ${message}\n`);
  process.exitCode = error instanceof NoRunError ? 1 : 2;
}
