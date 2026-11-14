import { defineContract, contractTest } from '@behavproof/vitest';
const first=defineContract({id:'MUTATE',intent:'fixed expectation',risk:'critical',cases:[{id:'nested',input:{v:1},expected:{nested:{v:1}}}]});
contractTest.each(first,(entry)=>{entry.expected.nested.v=2;return {nested:{v:2}}});
const second=defineContract({id:'LATER',intent:'fixed at registration',risk:'critical',cases:[{id:'later',input:{v:1},expected:{nested:{v:1}}}]});
contractTest.each(second,()=>({nested:{v:2}}));
second.cases[0].expected.nested.v=2;
