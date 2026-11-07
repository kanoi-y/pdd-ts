#!/usr/bin/env node
import {prepareHumanReview} from '../dist/ci/review.js';
const result=await prepareHumanReview(process.cwd());
console.log(`Created specification review request: ${result.url}`);
console.log('Human approval: pending. Review personally in GitHub at the pinned head.');
