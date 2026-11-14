import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { GitHubTransport } from '../../packages/adapter-github/src/transport.js';

test('uses bounded real HTTP reads, fixed origin, no redirect follow and no credential diagnostics',async()=>{
  const server=createServer((req,res)=>{
    if(req.url?.includes('redirect')){res.writeHead(302,{location:'https://example.invalid/steal'});res.end();}
    else if(req.url?.includes('large'))res.end('x'.repeat(200));
    else{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('No server');
    const seen:RequestInit[]=[];
    const transport=new GitHubTransport({repository:'acme/shop',maxBytes:100,fetcher:async(url,options)=>{
      expect(new URL(url).origin).toBe('https://api.github.com');seen.push(options!);
      return fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`,options);
    }});
    expect(await transport.request('/repos/acme/shop/ok')).toEqual({ok:true});
    await expect(transport.request('/repos/acme/shop/redirect')).rejects.toThrow('GitHub HTTP 302');
    await expect(transport.request('/repos/acme/shop/large')).rejects.toThrow('size limit');
    await expect(transport.request('/repos/other/shop/x')).rejects.toThrow('endpoint');
    expect(seen.every(x=>x.redirect==='manual')).toBe(true);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('times out even when the transport ignores AbortSignal',async()=>{
  const transport=new GitHubTransport({repository:'acme/shop',timeoutMs:5,fetcher:()=>new Promise(()=>{})});
  await expect(transport.request('/repos/acme/shop/x')).rejects.toThrow('timed out');
});
test('bounds pagination, rejects duplicate identities and invalid JSON',async()=>{
  const t=new GitHubTransport({repository:'acme/shop',maxPages:1,fetcher:async()=>new Response(JSON.stringify(Array.from({length:100},(_,id)=>({id}))))});
  await expect(t.pages('/repos/acme/shop/x')).rejects.toThrow('pagination limit');
  const duplicate=new GitHubTransport({repository:'acme/shop',fetcher:async()=>new Response('[{"id":1},{"id":1}]')});
  await expect(duplicate.pages('/repos/acme/shop/x')).rejects.toThrow('Ambiguous');
  const malformed=new GitHubTransport({repository:'acme/shop',fetcher:async()=>new Response('test-secret-not-real')});
  await expect(malformed.request('/repos/acme/shop/x')).rejects.toThrow('unavailable or malformed');
});
