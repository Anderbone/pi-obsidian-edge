import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist');
const staging = await mkdtemp(path.join(tmpdir(), 'pi-edge-bridge-'));
try {
  await mkdir(output, { recursive: true });
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await build({ entryPoints: [path.join(root, 'bridge/cli.mts')], outfile: path.join(staging, 'cli.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['bufferutil', 'utf-8-validate'], legalComments: 'inline' });
  await chmod(path.join(staging, 'cli.cjs'), 0o755);
  await copyFile(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'));
  const notices = await Promise.all(['ws', 'qrcode-terminal'].map(async name =>
    `${name}\n${await readFile(path.join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`));
  const qrNotice = 'QRCode for JavaScript\nCopyright (c) 2009 Kazuhiko Arase\nLicensed under the MIT license.\n';
  const mit = await readFile(path.join(root, 'LICENSE'), 'utf8');
  notices.push(qrNotice + mit.slice(mit.indexOf('Permission is hereby granted')));
  await writeFile(path.join(staging, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n\n'));
  await writeFile(path.join(staging, 'package.json'), JSON.stringify({
    name: 'pi-edge-bridge', version: metadata.version, description: metadata.description,
    license: metadata.license, repository: metadata.repository, engines: { node: '>=22' },
    bin: { 'pi-edge-bridge': 'cli.cjs' }, files: ['cli.cjs', 'LICENSE', 'THIRD-PARTY-LICENSES.txt']
  }, null, 2) + '\n');
  if (!process.env.npm_execpath) throw new Error('Run this script using npm run build:bridge.');
  const packed = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', staging, '--pack-destination', output, '--ignore-scripts', '--json'], { encoding: 'utf8', cwd: root }));
  await rename(path.join(output, packed[0].filename), path.join(output, 'pi-edge-bridge.tgz'));
  console.log('Built dist/pi-edge-bridge.tgz (bundled dependencies; no user build required).');
} finally {
  await rm(staging, { recursive: true, force: true });
}
