import { test, expect } from 'vitest';
import { parseConfig, resolveRisk } from '../../packages/core/src/index.js';
test('risk selectors choose explicit path, module and Contract-kind profiles',()=>{
 const cfg=parseConfig({schemaVersion:1,profile:'basic',riskOverrides:[{selector:{kind:'path',value:'src/auth/**'},profile:'critical'},{selector:{kind:'module',value:'payments'},profile:'standard'},{selector:{kind:'contract-kind',value:'state_machine'},profile:'critical'}]});
 expect(resolveRisk(cfg,{path:'src/other.ts'})).toBe('basic');expect(resolveRisk(cfg,{path:'src/auth/access.ts'})).toBe('critical');expect(resolveRisk(cfg,{path:'src/pay.ts',module:'payments'})).toBe('standard');expect(resolveRisk(cfg,{path:'src/state.ts',contractKind:'state_machine'})).toBe('critical');
});
test('a declaration or protected floor cannot be silently lowered by an override',()=>{
 const cfg=parseConfig({schemaVersion:1,riskOverrides:[{selector:{kind:'path',value:'src/**'},profile:'basic'}]});
 expect(resolveRisk(cfg,{path:'src/auth.ts',declaredRisk:'critical'})).toBe('critical');expect(resolveRisk(cfg,{path:'src/a.ts'},'standard')).toBe('standard');
 expect(()=>parseConfig({schemaVersion:1,riskOverrides:[{selector:{kind:'path',value:'../outside'},profile:'critical'}]})).toThrow();
});
