import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { RelativePathSchema } from './schemas.js';
export const DEFAULT_MAX_BYTES=10*1024*1024;
/** Read only regular files under root. All symlink components are rejected. */
export async function safeRead(root:string,path:string,maxBytes=DEFAULT_MAX_BYTES):Promise<Buffer>{
  RelativePathSchema.parse(path);
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError('Invalid byte limit');
  const actualRoot=await realpath(root);
  const target=join(actualRoot,...path.split('/'));
  const ensurePath=async()=>{
    let current=actualRoot;
    for(const part of path.split('/')){
      current=join(current,part);
      const entry=await lstat(current);
      if(entry.isSymbolicLink())throw new Error('Symlink paths are not allowed');
    }
    const actual=await realpath(target),scoped=relative(actualRoot,actual);
    if(scoped==='..'||scoped.startsWith(`..${sep}`)||actual!==target)throw new Error('Path escapes read root');
  };
  await ensurePath();
  const handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await handle.stat();
    if(!before.isFile())throw new Error('Only regular files may be read');
    if(before.size>maxBytes)throw new Error('File exceeds size limit');
    await ensurePath();
    const named=await lstat(target);
    if(named.dev!==before.dev||named.ino!==before.ino)throw new Error('File changed during scoped open');
    const chunks:Buffer[]=[];let total=0;
    for(;;){
      const chunk=Buffer.alloc(Math.min(64*1024,maxBytes-total+1));
      const {bytesRead}=await handle.read(chunk,0,chunk.length,null);
      if(bytesRead===0)break;
      total+=bytesRead;
      if(total>maxBytes)throw new Error('File exceeds size limit');
      chunks.push(chunk.subarray(0,bytesRead));
    }
    await ensurePath();
    const after=await handle.stat();
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('File changed during read');
    return Buffer.concat(chunks,total);
  }finally{await handle.close();}
}
export async function safeReadJson(root:string,path:string,maxBytes=DEFAULT_MAX_BYTES):Promise<unknown>{
  const bytes=await safeRead(root,path,maxBytes);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return JSON.parse(text) as unknown;
}
