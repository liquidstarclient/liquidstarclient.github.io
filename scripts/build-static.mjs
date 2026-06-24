import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const directories = ['assets', 'docs', 'download', 'downloads', 'features', 'legal', 'support'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'index.html'), path.join(output, 'index.html'));

for (const directory of directories) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}

console.log('Static website prepared in dist/');
