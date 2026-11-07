import os from 'node:os';
import { runProcess } from '../verification/process.js';
export interface GitHubClient { get(route: string): Promise<unknown> }
/** Credentials are supplied only to the fixed gh executable, never candidate processes. */
export class GhClient implements GitHubClient {
  constructor(private readonly cwd: string) {}
  async get(route: string): Promise<unknown> {
    if (route.split(/[/?]/).includes('..')) throw new Error('Invalid GitHub API route');
    if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./%?=&-]+)?$/.test(route)) throw new Error('Invalid GitHub API route');
    const env: Record<string,string> = { HOME: os.homedir(), GH_PROMPT_DISABLED: '1' };
    for (const key of ['GH_TOKEN','GITHUB_TOKEN','GH_CONFIG_DIR']) if (process.env[key]) env[key] = process.env[key]!;
    const result = await runProcess('gh', ['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json', route], { cwd: this.cwd, env, timeoutMs:30000, maxOutputBytes:4_194_304 });
    if (result.status !== 'completed' || result.exitCode !== 0) throw new Error('GitHub API unavailable or permission denied');
    return JSON.parse(result.stdout);
  }
}
