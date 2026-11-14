import { test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { verifyArtifactArchive } from '../../packages/adapter-github/src/index.js';
const read=(name:string)=>readFile(new URL(`../fixtures/github/${name}-artifact.zip`,import.meta.url));
test('independently verified GitHub archive must contain the exact evaluated manifest and reports',async()=>{
 const bytes=await read('valid'),files={'input/manifest.json':Buffer.from('{"run":1}'),'input/vitest.json':Buffer.from('{"success":true}')},entries={'input/manifest.json':'manifest.json','input/vitest.json':'vitest.json'};
 expect(verifyArtifactArchive(bytes,files,entries).status).toBe('pass');
 expect(verifyArtifactArchive(bytes,{...files,'input/vitest.json':Buffer.from('forged')},entries).status).toBe('unknown');
 expect(verifyArtifactArchive(bytes,files,{'input/manifest.json':'manifest.json'}).status).toBe('unknown');
 expect(verifyArtifactArchive(bytes.subarray(0,30),files,entries).status).toBe('unknown');
});
test('unsafe or oversized zip entries are rejected without extracting files',async()=>{
 expect(verifyArtifactArchive(await read('unsafe'),{},{}).status).toBe('unknown');
 expect(verifyArtifactArchive(await read('large'),{},{}).status).toBe('unknown');
});
test('bounded archive decoding exposes bytes without extracting or authenticating them',async()=>{
 const {readArtifactArchive}=await import('../../packages/adapter-github/src/index.js');const input=await read('valid'),decoded=readArtifactArchive(input);expect(decoded.status).toBe('pass');expect(decoded.entries.get('manifest.json')).toEqual(Buffer.from('{"run":1}'));
 const unsafe=readArtifactArchive(await read('unsafe'));expect(unsafe.status).toBe('unknown');expect(unsafe.entries.size).toBe(0);
});
