import { createHash } from 'node:crypto';
export function canonicalJson(value:unknown):string{
  const seen=new Set<object>();
  function serialize(v:unknown):string{
    if(v===null)return 'null';
    if(typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'){if(!Number.isFinite(v))throw new TypeError('Non-finite JSON number');return JSON.stringify(v);}
    if(typeof v!=='object')throw new TypeError('Value is not JSON');
    if(seen.has(v))throw new TypeError('Cyclic JSON');seen.add(v);
    try{
      if(Array.isArray(v)){
        if(Reflect.ownKeys(v).length!==v.length+1)throw new TypeError('Sparse or extended array');
        const items:string[]=[];
        for(let i=0;i<v.length;i++){
          const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
          if(!descriptor||!('value' in descriptor))throw new TypeError('Sparse arrays or accessors are not JSON');
          items.push(serialize(descriptor.value));
        }
        return `[${items.join(',')}]`;
      }
      const proto=Object.getPrototypeOf(v);
      if(proto!==Object.prototype&&proto!==null)throw new TypeError('Expected plain JSON object');
      if(Reflect.ownKeys(v).some(k=>typeof k==='symbol'))throw new TypeError('Symbol keys are not JSON');
      return `{${Object.keys(v).sort().map(k=>{
        const descriptor=Object.getOwnPropertyDescriptor(v,k)!;
        if(!('value' in descriptor))throw new TypeError('JSON accessors are not supported');
        return `${JSON.stringify(k)}:${serialize(descriptor.value)}`;
      }).join(',')}}`;
    }finally{seen.delete(v);}
  }
  return serialize(value);
}
export function hash(value:unknown):string{return hashBytes(Buffer.from(canonicalJson(value),'utf8'));}
export function hashBytes(bytes:Uint8Array):string{return createHash('sha256').update(bytes).digest('hex');}
