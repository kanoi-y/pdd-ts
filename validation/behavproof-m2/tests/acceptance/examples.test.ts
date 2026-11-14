import { test, expect } from 'vitest';
import { readOrder } from '../../examples/node-api/src/orders.js';
import { GET } from '../../examples/nextjs/app/api/orders/route.js';
test('Node service and Next-compatible HTTP route enforce owner/non-owner and unauthenticated boundaries',async()=>{
 const order={id:'order-1',ownerId:'alice',total:120};expect(readOrder('alice',order)).toEqual(order);expect(readOrder('bob',order)).toBeNull();
 const request=(user?:string)=>new Request('https://example.invalid/api/orders',user?{headers:{'x-example-user':user}}:{});
 expect((await GET(request())).status).toBe(401);expect((await GET(request('bob'))).status).toBe(404);
 const response=await GET(request('alice'));expect(response.status).toBe(200);expect(await response.json()).toEqual(order);
});
