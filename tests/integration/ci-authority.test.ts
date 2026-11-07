import {describe,it,expect} from 'vitest';
import {publishTrustedCheck} from '../../src/ci/publish.js';
import {runTrustedCandidate} from '../../src/ci/runner.js';
describe('CI-006 privileged entrypoint authority',()=>{
 it.each([
  {event:'pull_request',ref:'refs/pull/1/merge'},
  {event:'workflow_dispatch',ref:'refs/heads/attacker'},
  {event:'push',ref:'refs/heads/main'},
 ])('rejects $event at $ref before repository access or publication',async({event,ref})=>{
  const previousEvent=process.env.GITHUB_EVENT_NAME,previousRef=process.env.GITHUB_REF;
  process.env.GITHUB_EVENT_NAME=event;process.env.GITHUB_REF=ref;
  try {
   await expect(runTrustedCandidate('/nonexistent-authority-test',1)).rejects.toThrow(/Trusted/);
   await expect(publishTrustedCheck('/nonexistent-authority-test',1)).rejects.toThrow(/Trusted/);
  }finally{
   if(previousEvent===undefined)delete process.env.GITHUB_EVENT_NAME;else process.env.GITHUB_EVENT_NAME=previousEvent;
   if(previousRef===undefined)delete process.env.GITHUB_REF;else process.env.GITHUB_REF=previousRef;
  }
 });
 it('does not publish a bootstrap trial or interpolate a malformed PR input',async()=>{
  await expect(publishTrustedCheck('/nonexistent-authority-test',0)).rejects.toThrow();
  await expect(runTrustedCandidate('/nonexistent-authority-test',Number('1; whoami'))).rejects.toThrow();
 });
});
