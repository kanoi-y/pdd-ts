import {test,expect} from 'vitest';import {mkdtemp,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {validateStagedSdk} from '../../scripts/staged-sdk.mjs';
test.skipIf(process.platform==='win32')('a symlink alias cannot turn the complete workspace into a sandbox SDK mount',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-sdk-alias-')),alias=join(scratch,'sdk');try{await symlink(resolve('.'),alias);await expect(validateStagedSdk(alias,{referenceRoot:resolve('.')})).rejects.toThrow(/checkout|outside|workspace/i);}finally{await rm(scratch,{recursive:true,force:true});}
});
test('a root host cannot silently map its privileged UID into the candidate container',async()=>{
 await expect(validateStagedSdk('/not-read',{uid:0,referenceRoot:resolve('.')})).rejects.toThrow(/non.root/i);
});
