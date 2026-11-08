import { readFile, lstat, mkdir, unlink, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveProjectPath } from '../verification/paths.js';
import { writeProjectFile } from '../requirements/io.js';
export const skillNames = ['pdd-intake', 'pdd-plan', 'pdd-implement', 'pdd-verify', 'pdd-review'] as const;
/** Explicit project-local adapter; no personal configuration or existing destination is replaced. */
export async function installSkills(root: string, agent: string): Promise<{
    agent: 'codex';
    installed: string[];
    supportingFiles: string[];
}> {
    if (agent !== 'codex')
        throw new Error('Only the validated codex project adapter is available');
    const files = [...skillNames.map(name => `${name}/SKILL.md`), 'pdd-plan/references/decisions.md'];
    const data = await Promise.all(files.map(file => readFile(fileURLToPath(new URL(`../../templates/skills/${file}`, import.meta.url)), 'utf8')));
    for (const name of skillNames) {
        const directory = await resolveProjectPath(root, `.agents/skills/${name}`, { allowMissing: true });
        try {
            await lstat(directory);
            throw new Error('Skill destination already exists');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error;
        }
    }
    const written: string[] = [], directories: string[] = [];
    try {
        await mkdir(await resolveProjectPath(root, '.agents/skills', { allowMissing: true }), { recursive: true });
        for (const name of [...skillNames, 'pdd-plan/references']) {
            const dir = `.agents/skills/${name}`;
            await mkdir(await resolveProjectPath(root, dir, { allowMissing: true }));
            directories.push(dir);
        }
        for (const [i, file] of files.entries()) {
            const target = `.agents/skills/${file}`;
            await writeProjectFile(root, target, data[i]!);
            written.push(target);
        }
    }
    catch (error) {
        for (const file of written) {
            const i = files.findIndex(f => file === `.agents/skills/${f}`);
            try {
                const resolved = await resolveProjectPath(root, file);
                if (await readFile(resolved, 'utf8') === data[i])
                    await unlink(resolved);
            }
            catch { /* Preserve replaced paths. */ }
        }
        for (const dir of directories.reverse()) {
            try {
                await rmdir(await resolveProjectPath(root, dir));
            }
            catch { /* Never remove nonempty/replaced directories. */ }
        }
        throw error;
    }
    return { agent: 'codex', installed: written.filter(f => f.endsWith('/SKILL.md')), supportingFiles: written.filter(f => !f.endsWith('/SKILL.md')) };
}
