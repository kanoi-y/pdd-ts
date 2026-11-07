import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { identifier, digestSchema, evidenceSchema } from '../requirements/schema.js';
import { inspectTarget } from './contracts.js';
import type { ProofTarget } from './contracts.js';
import { digestFiles, sha256 } from './digest.js';
import { resolveProjectPath } from './paths.js';
import { runProcess } from './process.js';
import type { ProcessResult } from './process.js';
import { describeToolchain } from './toolchain.js';
import type { VerificationTools } from './toolchain.js';
import type { EvidenceRecord } from './types.js';
import { evaluateDafnyAudit, evaluateDafnyLog } from './dafny-log.js';

export interface SourceProofTarget extends ProofTarget {
  obligationId: string;
  requirementIds: string[];
  contractIds: string[];
}
export interface VerificationRun { id: string; commit: string; specDigest: string }
export interface VerificationOutcome { record: EvidenceRecord; inputPaths: string[]; diagnostics: string[] }

/** Source/artifact freshness; the policy gate separately compares current spec and toolchain digests. */
export async function checkEvidenceFreshness(root: string, evidence: EvidenceRecord, currentInputPaths: string[]): Promise<'fresh' | 'stale'> {
  try {
    const input = await digestFiles(root, currentInputPaths);
    if (input.digest !== evidence.sourceDigest) return 'stale';
    const artifacts = await digestFiles(root, evidence.artifactPaths);
    if (evidence.artifactPaths.some(file => artifacts.files[file] !== evidence.artifactDigests[file])) return 'stale';
    return 'fresh';
  } catch { return 'stale'; }
}

/** Each target owns a new artifact directory; it cannot substitute an older successful run. */
export async function verifySource(root: string, target: SourceProofTarget, identity: VerificationRun, options: VerificationTools = {}): Promise<VerificationOutcome> {
  identifier.parse(identity.id);
  identifier.parse(target.obligationId);
  z.array(identifier).min(1).parse(target.requirementIds);
  z.array(identifier).min(1).parse(target.contractIds);
  digestSchema.parse(identity.specDigest);
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(identity.commit)) throw new Error('A source commit is required');
  const directory = `.pdd/evidence/${identity.id}/${target.obligationId}`;
  const parent = await resolveProjectPath(root, `.pdd/evidence/${identity.id}`, { allowMissing: true });
  await mkdir(parent, { recursive: true });
  const absoluteDirectory = await resolveProjectPath(root, directory, { allowMissing: true });
  await mkdir(absoluteDirectory); // EEXIST deliberately rejects replay/overwrite.
  const artifacts: string[] = [];
  const diagnostics: string[] = [];
  const emptyDigest = sha256('');
  let inputPaths: string[] = [];
  const record: EvidenceRecord = {
    id: `proof-${sha256(`${identity.id}:${target.obligationId}`).slice(0, 48)}`, obligationId: target.obligationId,
    requirementIds: target.requirementIds, kind: 'source-proof', status: 'error', scope: `${target.file}#${target.symbol}`,
    assumptions: ['profile:pdd-pure-v1'], artifactPaths: [], artifactDigests: {}, verifiedSymbols: [],
    verifiedContractIds: [], premiseEvidenceIds: [], proofInputDigest: emptyDigest,
    sourceDigest: emptyDigest, specDigest: identity.specDigest, toolchainDigest: emptyDigest,
    commit: identity.commit, run: { id: identity.id, origin: 'local' },
  };
  const artifact = async (name: string, content: string): Promise<void> => {
    const relative = `${directory}/${name}`;
    const file = await resolveProjectPath(root, relative, { allowMissing: true });
    await writeFile(file, content, { flag: 'wx' });
    artifacts.push(relative);
  };
  const capture = async (name: string, process: ProcessResult): Promise<void> => {
    await artifact(name, JSON.stringify(process, null, 2) + '\n');
  };
  try {
    if (!target.file.endsWith('.ts')) throw new Error('Only .ts source targets are supported');
    const inspected = await inspectTarget(root, target, { ...(options.lscPath ? { lscPath: options.lscPath } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
    await artifact('inspection.json', JSON.stringify(inspected, null, 2) + '\n');
    if (inspected.status !== 'supported' || !inspected.contracts || !inspected.emittedLemma || !inspected.witness) {
      record.status = inspected.status === 'supported' ? 'unknown' : inspected.status;
      diagnostics.push(...inspected.reasons);
    } else {
      const tools = await describeToolchain(root, options);
      record.toolchainDigest = tools.digest;
      await artifact('toolchain.json', JSON.stringify(tools.manifest, null, 2) + '\n');
      const source = await resolveProjectPath(root, target.file);
      const config = await resolveProjectPath(root, 'lemmascript.json');
      const stem = target.file.slice(0, -3);
      const proofRelative = `.pdd/proofs/${stem}.dfy`;
      const generatedRelative = proofRelative + '.gen';
      const proof = await resolveProjectPath(root, proofRelative, { allowMissing: true });
      await resolveProjectPath(root, generatedRelative, { allowMissing: true });
      const generation = await runProcess(process.execPath, [tools.lsc, 'gen-check', '--backend=dafny', `--config=${config}`, source], { cwd: root, timeoutMs: options.timeoutMs ?? 30000 });
      await capture('generation.json', generation);
      if (generation.status !== 'completed') record.status = generation.status === 'error' ? 'error' : 'unknown';
      else if (generation.exitCode !== 0) { record.status = 'failed'; diagnostics.push('Proof regeneration or additions-only check failed'); }
      else if ((await digestFiles(root, inspected.sourceFiles)).digest !== inspected.sourceDigest) {
        record.status = 'stale'; diagnostics.push('Source changed after inspection');
      } else {
        inputPaths = [...inspected.sourceFiles, proofRelative, generatedRelative];
        for (const optional of ['tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'package-lock.json']) {
          try { await resolveProjectPath(root, optional); inputPaths.push(optional); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        const inputs = await digestFiles(root, inputPaths);
        record.sourceDigest = inputs.digest;
        record.proofInputDigest = inputs.files[proofRelative]!;
        artifacts.push(proofRelative, generatedRelative);
        await artifact('inputs.json', JSON.stringify(inputs, null, 2) + '\n');
        // gen-check preserves lines, not Dafny semantics: added premises or comments can replace the model.
        const generatedFile = await resolveProjectPath(root, generatedRelative);
        if (!(await readFile(proof)).equals(await readFile(generatedFile))) {
          record.status = 'failed';
          diagnostics.push('Unapproved Dafny proof additions or assumptions: the initial source-proof profile requires the freshly generated model byte for byte');
        } else {
          // Includes would introduce undeclared proof dependencies; the initial profile rejects them.
          if (/\binclude\s*"/.test(await readFile(proof, 'utf8'))) throw new Error('Untracked proof include is unsupported');
          const audit = await runProcess(tools.dafny, ['audit', proof], { cwd: root, timeoutMs: options.timeoutMs ?? 30000 });
          await capture('audit.json', audit);
          const auditStatus = evaluateDafnyAudit(audit.stdout);
          if (audit.status !== 'completed') record.status = audit.status === 'error' ? 'error' : 'unknown';
          else if (audit.exitCode !== 0 || auditStatus !== 'clean') {
            record.status = auditStatus === 'unknown' ? 'unknown' : 'failed'; diagnostics.push('Dafny audit did not establish a clean assumption/axiom set');
          } else {
            const resultsRelative = `${directory}/members.log`;
            const resultsFile = await resolveProjectPath(root, resultsRelative, { allowMissing: true });
            const verification = await runProcess(tools.dafny, ['verify', proof, '--unicode-char:false', '--allow-deprecation', '--solver-path', tools.solver, '--log-format', `text;LogFileName=${resultsFile}`], { cwd: root, timeoutMs: options.timeoutMs ?? 30000 });
            await capture('verification.json', verification);
            if (verification.status !== 'completed') record.status = verification.status === 'error' ? 'error' : 'unknown';
            else if (verification.exitCode !== 0) { record.status = 'failed'; diagnostics.push('Verifier rejected the source implementation'); }
            else {
              if ((await stat(resultsFile)).size > 1_048_576) throw new Error('Verifier member log exceeds artifact size limit');
              const members = await readFile(resultsFile, 'utf8');
              artifacts.push(resultsRelative);
              const memberStatus = evaluateDafnyLog(members, inspected.emittedLemma);
              if (memberStatus !== 'verified') {
                record.status = memberStatus === 'failed' ? 'failed' : 'unknown'; diagnostics.push('Missing or unsuccessful proof member for the source postcondition');
              } else {
                record.status = 'passed';
                record.verifiedSymbols = [target.symbol];
                record.verifiedContractIds = target.contractIds;
                record.premiseEvidenceIds = [`witness-${sha256(JSON.stringify(inspected.witness)).slice(0, 24)}`];
              }
            }
          }
        }
        if ((await digestFiles(root, inputPaths)).digest !== inputs.digest) {
          record.status = 'stale'; record.verifiedContractIds = []; diagnostics.push('Verification inputs changed during the run');
        }
      }
    }
  } catch (error) {
    record.status = 'error'; diagnostics.push(error instanceof Error ? error.message : 'Verification adapter error');
  }
  await artifact('diagnostics.json', JSON.stringify(diagnostics, null, 2) + '\n');
  record.artifactPaths = artifacts;
  record.artifactDigests = (await digestFiles(root, artifacts)).files;
  evidenceSchema.parse(record);
  await writeFile(path.join(absoluteDirectory, 'record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return { record, inputPaths, diagnostics };
}
