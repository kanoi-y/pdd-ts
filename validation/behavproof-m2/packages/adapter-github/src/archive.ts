import { inflateRawSync, crc32 } from 'node:zlib';
import { RelativePathSchema, hashBytes } from '@behavproof/core';
import { observed, unknown } from './transport.js';
/** No extraction or filesystem writes. Caller authenticates archive digest separately. */
export function verifyArtifactArchive(input:Uint8Array,files:Readonly<Record<string,Uint8Array>>,entryMap:Readonly<Record<string,string>>){
 try {
  const zip=Buffer.from(input);if(zip.length>10*1024*1024||zip.length<22)throw Error('Archive size invalid');
  let end=-1;for(let p=zip.length-22;p>=Math.max(0,zip.length-65557);p--)if(zip.readUInt32LE(p)===0x06054b50&&p+22+zip.readUInt16LE(p+20)===zip.length){end=p;break;}
  if(end<0||zip.readUInt16LE(end+4)!==0||zip.readUInt16LE(end+6)!==0)throw Error('Unsupported archive layout');
  const count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),start=zip.readUInt32LE(end+16);
  if(count!==zip.readUInt16LE(end+8)||count>10000||start+size!==end)throw Error('Archive directory invalid');
  let cursor=start,total=0;const entries=new Map<string,Buffer>();
  const decode=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  for(let i=0;i<count;i++){
   if(cursor+46>end||zip.readUInt32LE(cursor)!==0x02014b50)throw Error('Archive entry invalid');
   const flags=zip.readUInt16LE(cursor+8),method=zip.readUInt16LE(cursor+10),crc=zip.readUInt32LE(cursor+16),compressed=zip.readUInt32LE(cursor+20),uncompressed=zip.readUInt32LE(cursor+24),nameLength=zip.readUInt16LE(cursor+28),extra=zip.readUInt16LE(cursor+30),comment=zip.readUInt16LE(cursor+32),disk=zip.readUInt16LE(cursor+34),mode=zip.readUInt32LE(cursor+38)>>>16,offset=zip.readUInt32LE(cursor+42);
   if(cursor+46+nameLength+extra+comment>end||disk!==0||(flags&1)!==0||![0,8].includes(method)||uncompressed>10*1024*1024||(total+=uncompressed)>32*1024*1024)throw Error('Unsupported or oversized archive entry');
   const name=decode(zip.subarray(cursor+46,cursor+46+nameLength));RelativePathSchema.parse(name.endsWith('/')?name.slice(0,-1):name);
   if(entries.has(name)||((mode&0xf000)!==0&&![0x8000,0x4000].includes(mode&0xf000)))throw Error('Duplicate or non-regular archive entry');
   if(offset+30>start||zip.readUInt32LE(offset)!==0x04034b50||zip.readUInt16LE(offset+6)!==flags||zip.readUInt16LE(offset+8)!==method)throw Error('Local archive entry mismatch');
   const localName=zip.readUInt16LE(offset+26),localExtra=zip.readUInt16LE(offset+28),dataStart=offset+30+localName+localExtra;
   if(dataStart+compressed>start||decode(zip.subarray(offset+30,offset+30+localName))!==name)throw Error('Archive data bounds mismatch');
   const encoded=zip.subarray(dataStart,dataStart+compressed),data=method===0?encoded:inflateRawSync(encoded,{maxOutputLength:10*1024*1024});
   if(data.length!==uncompressed||crc32(data)!==crc)throw Error('Archive payload mismatch');
   entries.set(name,data);cursor+=46+nameLength+extra+comment;
  }
  if(cursor!==end||Object.keys(files).length!==Object.keys(entryMap).length||new Set(Object.values(entryMap)).size!==Object.values(entryMap).length)throw Error('Archive mapping incomplete or ambiguous');
  for(const [ref,bytes] of Object.entries(files)){
   RelativePathSchema.parse(ref);const name=entryMap[ref];if(!name||!entries.has(name)||hashBytes(entries.get(name)!)!==hashBytes(bytes))throw Error('Evaluated file differs from authenticated archive');
  }
  return observed({files:Object.keys(files).sort()},[]);
 }catch{return unknown('Artifact archive is unsafe, unsupported or does not match evaluated bytes');}
}
