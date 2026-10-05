import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = 'kasahart/wandas-gui';
const files = { 'index.ts': 'src/index.ts', 'LICENSE.md': 'LICENSE.md', 'NOTICE.md': 'NOTICE.md' };
const toolPath = 'scripts/sync-gui-core.mjs';
const thisTool = fileURLToPath(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
const argument = flag => {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--'))
    throw new Error(`Missing ${flag} argument`);
  return resolve(process.argv[index + 1]);
};

if (process.argv.includes('--check')) {
  const destination = argument('--check');
  const pin = JSON.parse(readFileSync(join(destination, 'upstream.json'), 'utf8'));
  if (pin.repository !== repository || pin.path !== 'src' || !/^[a-f0-9]{40}$/.test(pin.commit))
    throw new Error('Invalid GUI core provenance');
  for (const file of Object.keys(files))
    if (hash(readFileSync(join(destination, file))) !== pin.sha256[file])
      throw new Error(`GUI core snapshot changed: ${file}. Re-sync from the canonical repository.`);
  if (hash(readFileSync(thisTool)) !== pin.toolSha256)
    throw new Error('GUI core sync tool changed. Re-sync the canonical tool.');
  console.log('GUI core source, attribution and sync tool match pinned hashes');
} else {
  const source = argument('--from');
  const destination = argument('--into');
  const git = (...args) => execFileSync('git', ['-C', source, ...args]);
  if (git('rev-parse', '--show-prefix').toString().trim() !== '')
    throw new Error('Source must be the canonical repository root');
  const origin = git('remote', 'get-url', 'origin').toString().trim();
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)kasahart\/wandas-gui(?:\.git)?\/?$/.test(origin))
    throw new Error('Source origin must be kasahart/wandas-gui');
  const commit = git('rev-parse', 'HEAD').toString().trim();
  const publishedRefs = git('for-each-ref', '--format=%(refname)', '--contains', commit, 'refs/remotes/origin').toString().trim().split('\n');
  if (!publishedRefs.some(ref => ref && ref !== 'refs/remotes/origin/HEAD'))
    throw new Error('Push the canonical commit to origin before syncing');
  if (git('status', '--porcelain', '--', ...Object.values(files), toolPath).toString().trim())
    throw new Error('Commit the canonical source and tool before syncing');
  const tool = git('show', `${commit}:${toolPath}`);
  if (!readFileSync(thisTool).equals(tool)) {
    writeFileSync(thisTool, tool);
    execFileSync(process.execPath, [thisTool, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(0);
  }
  const blobs = Object.fromEntries(Object.entries(files).map(([file, path]) => [file, git('show', `${commit}:${path}`)]));
  const sha256 = Object.fromEntries(Object.entries(blobs).map(([file, bytes]) => [file, hash(bytes)]));
  mkdirSync(destination, { recursive: true });
  for (const [file, bytes] of Object.entries(blobs)) writeFileSync(join(destination, file), bytes);
  writeFileSync(thisTool, tool);
  writeFileSync(join(destination, 'upstream.json'), JSON.stringify({ repository, commit, path: 'src', sha256, toolSha256: hash(tool) }, null, 2) + '\n');
  console.log(`GUI core synchronized from ${repository}@${commit}`);
}
