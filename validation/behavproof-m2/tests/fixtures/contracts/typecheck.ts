import { defineContract, contractTest } from '@behavproof/vitest';
const c=defineContract({id:'x',intent:'x',risk:'critical',cases:[{id:'one',input:{owner:'alice'},expected:true}]});
contractTest.each(c,({input})=>input.owner.toUpperCase());
