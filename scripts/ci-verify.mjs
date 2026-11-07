#!/usr/bin/env node
import {runTrustedCandidate} from '../dist/ci/runner.js';
const pullNumber=Number(process.argv[2]??'0');
await runTrustedCandidate(process.cwd(),pullNumber);
