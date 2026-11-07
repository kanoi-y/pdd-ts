import path from 'node:path';
export const testImage='node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec';
export interface SandboxOptions {trustedRoot:string;projectRoot:string;artifactDirectory:string;name:string;command:string[];uid:number;gid:number}
export function sandboxArguments(options:SandboxOptions):string[] {
 for(const value of [options.trustedRoot,options.projectRoot,options.artifactDirectory]) if(!path.isAbsolute(value)||/[\x00-\x1f,]/.test(value)) throw new Error('Unsupported sandbox mount path');
 if(!options.projectRoot.startsWith(options.trustedRoot+path.sep) || !options.artifactDirectory.startsWith(options.projectRoot+path.sep) || !/^pdd-test-[a-z0-9-]+$/.test(options.name)) throw new Error('Invalid sandbox containment');
 const mount=(directory:string,readonly=false)=>`type=bind,src=${directory},dst=${directory}${readonly?',readonly':''}`;
 return ['run','--rm','--name',options.name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=3g','--cpus=2','--user',`${options.uid}:${options.gid}`,'--tmpfs','/tmp:rw,nosuid,nodev,size=1g','--mount',mount(options.trustedRoot,true),'--mount',mount(path.join(options.projectRoot,'.tools')),'--mount',mount(path.join(options.projectRoot,'dist')),'--mount',mount(options.artifactDirectory),'--workdir',options.projectRoot,testImage,...options.command];
}
