import { mkdir, writeFile, cp } from 'node:fs/promises';
import { z } from 'zod';
import { ConfigSchema, PolicySchema, EvidenceSchema, ExecutionManifestSchema, RegistrySnapshotSchema, getProfilePolicy } from '../packages/core/dist/index.js';
import { TrustRootSchema } from '../packages/cli/dist/api.js';
const root=new URL('../packages/cli/',import.meta.url);
for(const dir of ['schemas','presets','templates'])await mkdir(new URL(dir+'/',root),{recursive:true});
for(const [name,schema] of Object.entries({config:ConfigSchema,policy:PolicySchema,evidence:EvidenceSchema,manifest:ExecutionManifestSchema,registry:RegistrySnapshotSchema,'trust-root':TrustRootSchema})){
 const value=z.toJSONSchema(schema,{io:'input',unrepresentable:'any'});await writeFile(new URL(`schemas/${name}.schema.json`,root),JSON.stringify(value,null,2)+'\n');
}
for(const profile of ['basic','standard','critical'])await writeFile(new URL(`presets/${profile}-v1.json`,root),JSON.stringify(getProfilePolicy(profile),null,2)+'\n');
await cp(new URL('../templates/',import.meta.url),new URL('templates/',root),{recursive:true});
