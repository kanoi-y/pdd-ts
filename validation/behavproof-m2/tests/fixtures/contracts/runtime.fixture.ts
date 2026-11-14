import { describe, test } from 'vitest';
import { defineContract, contractTest } from '@behavproof/vitest';
const contract=defineContract({id:'ORDER',intent:'privacy',risk:'critical',cases:[{id:'owner',input:{owner:true},expected:'yes'},{id:'other',input:{owner:false},expected:'no'}]});
describe.skipIf(process.env.CONTRACT_SKIP==='1')('repeated',()=>{describe('nested',()=>{contractTest.each(contract,({input})=>process.env.CONTRACT_FAIL==='1'?'wrong':input.owner?'yes':'no');});});
describe('repeated',()=>{test.skipIf(process.env.INVENTORY_FULL!=='1')('skipped',()=>{});});
