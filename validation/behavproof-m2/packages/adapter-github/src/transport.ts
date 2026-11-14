import { hash } from '@behavproof/core';
export type Fetcher = (url:string|URL, options?:RequestInit)=>Promise<Response>;
export interface GitHubOptions {repository:string; token?:string; fetcher?:Fetcher; timeoutMs?:number; maxBytes?:number; maxPages?:number}
export interface Observation<T=unknown> {status:'pass'|'unknown'; value?:T; reasons:string[]; sources:string[]; snapshotHash?:string}
export const unknown = <T=unknown>(reason:string):Observation<T>=>({status:'unknown',reasons:[reason],sources:[]});
export const observed = <T>(value:T,sources:string[]):Observation<T>=>({status:'pass',value,reasons:[],sources,snapshotHash:hash(value)});
export function object(value:unknown):Record<string,any> {if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Malformed GitHub response');return value as Record<string,any>;}
export class GitHubTransport {
  readonly repository:string; readonly prefix:string; readonly maxPages:number;
  private readonly fetcher:Fetcher; private readonly timeout:number; private readonly maxBytes:number;
  constructor(private readonly options:GitHubOptions){
    if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)||options.repository.split('/').some(x=>x==='.'||x==='..'))throw Error('Invalid repository');
    this.repository=options.repository;this.prefix=`/repos/${this.repository}`;this.fetcher=options.fetcher??fetch;
    this.timeout=options.timeoutMs??15000;this.maxBytes=options.maxBytes??10*1024*1024;this.maxPages=options.maxPages??100;
    if(!Number.isInteger(this.timeout)||this.timeout<1||this.timeout>60000||!Number.isInteger(this.maxBytes)||this.maxBytes<1||this.maxBytes>10*1024*1024||!Number.isInteger(this.maxPages)||this.maxPages<1||this.maxPages>100)throw Error('Invalid transport limits');
  }
  async request(path:string,query?:object):Promise<unknown>{
    if(!(path.startsWith(this.prefix+'/')&&!path.includes('..'))&&!(path==='/graphql'&&query))throw Error('Invalid GitHub endpoint');
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const operation=async()=>{
      const headers:Record<string,string>={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
      if(this.options.token)headers.Authorization=`Bearer ${this.options.token}`;
      const response=await this.fetcher(new URL(path,'https://api.github.com'),{method:query?'POST':'GET',headers,redirect:'manual',signal:abort.signal,...(query?{body:JSON.stringify(query)}:{})});
      if(!response.ok)throw Error(`GitHub HTTP ${response.status}`);
      if(!response.body)throw Error('Malformed GitHub response');
      const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
      try {for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>this.maxBytes)throw Error('GitHub response exceeds size limit');chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
    };
    try {return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('GitHub request timed out'));},this.timeout);})]);}
    catch(error){const message=error instanceof Error?error.message:'';throw Error(/^(GitHub HTTP \d{3}|GitHub request timed out|GitHub response exceeds size limit)$/.test(message)?message:'GitHub response unavailable or malformed');}
    finally {if(timer)clearTimeout(timer);}
  }
  async pages(path:string,key?:string):Promise<Record<string,any>[]>{
    const result:Record<string,any>[]=[];const ids=new Set<string>();
    for(let page=1;page<=this.maxPages;page++){
      const raw=await this.request(`${path}?per_page=100&page=${page}`);const rows=key?object(raw)[key]:raw;
      if(!Array.isArray(rows)||rows.length>100)throw Error('Malformed GitHub page');
      for(const value of rows){const row=object(value),id=String(row.id??'');if(!/^\d+$/.test(id)||ids.has(id))throw Error('Ambiguous GitHub page');ids.add(id);result.push(row);}
      if(rows.length<100)return result;
    }
    throw Error('GitHub pagination limit exceeded');
  }
}
