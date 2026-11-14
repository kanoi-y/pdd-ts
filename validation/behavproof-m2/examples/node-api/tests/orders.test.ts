import { defineContract, contractTest } from '@behavproof/vitest';
import { readOrder } from '../src/orders.js';
const ownership=defineContract({
  id:'ORDER-OWNERSHIP',intent:'An authenticated user can read their own order and cannot read another user’s order.',risk:'critical',
  cases:[
    {id:'owner',input:{userId:'alice',order:{id:'order-1',ownerId:'alice',total:120}},expected:{id:'order-1',ownerId:'alice',total:120}},
    {id:'non-owner',negative:true,input:{userId:'bob',order:{id:'order-1',ownerId:'alice',total:120}},expected:null},
  ],
});
contractTest.each(ownership,({input})=>readOrder(input.userId,input.order));
