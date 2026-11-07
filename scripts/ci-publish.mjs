#!/usr/bin/env node
import {publishTrustedCheck} from '../dist/ci/publish.js';
await publishTrustedCheck(process.cwd(),Number(process.argv[2]));
