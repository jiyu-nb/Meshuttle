import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '2.1.2';
const assets = {
  win32: {
    name: `syncthing-windows-amd64-v${version}.zip`,
    sha256: '4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96',
    executable: 'syncthing.exe'
  },
  darwin: {
    name: `syncthing-macos-universal-v${version}.zip`,
    sha256: '31ec0f7a58df841cfde5a69b00dd624cbc53400002c968ec789072cff83997b4',
    executable: 'syncthing'
  }
};

const asset = assets[process.platform];
if (!asset) throw new Error(`Unsupported platform for bundled Syncthing: ${process.platform}`);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(scriptDir);
const targetDir = path.join(projectRoot, 'client', 'vendor', 'syncthing');
const binaryPath = path.join(targetDir, asset.executable);
const requiredFiles = [asset.executable, 'LICENSE.txt', 'AUTHORS.txt', 'README.txt'];

if (requiredFiles.every((name) => fs.existsSync(path.join(targetDir, name)))) {
  const current = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
  if (current.status === 0 && `${current.stdout}${current.stderr}`.includes(`syncthing v${version}`)) {
    console.log(`Syncthing v${version} is ready for ${process.platform}.`);
    process.exit(0);
  }
}

const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'meshuttle-syncthing-'));
try {
  const archivePath = path.join(temporaryRoot, asset.name);
  const extractPath = path.join(temporaryRoot, 'extract');
  await fsp.mkdir(extractPath, { recursive: true });
  const url = `https://github.com/syncthing/syncthing/releases/download/v${version}/${asset.name}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Syncthing download failed: HTTP ${response.status}`);
  await fsp.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  const actualSha256 = crypto.createHash('sha256').update(await fsp.readFile(archivePath)).digest('hex');
  if (actualSha256 !== asset.sha256) {
    throw new Error(`Syncthing checksum mismatch. Expected ${asset.sha256}, got ${actualSha256}`);
  }

  const extracted = spawnSync('tar', ['-xf', archivePath, '-C', extractPath], { encoding: 'utf8' });
  if (extracted.status !== 0) throw new Error(`Unable to extract Syncthing archive: ${extracted.stderr || extracted.stdout}`);
  const sourceDir = await findSourceDirectory(extractPath, asset.executable);
  if (!sourceDir) throw new Error('Invalid Syncthing archive structure');

  await fsp.mkdir(targetDir, { recursive: true });
  await Promise.all(['syncthing.exe', 'syncthing'].map((name) => fsp.rm(path.join(targetDir, name), { force: true })));
  for (const name of requiredFiles) await fsp.copyFile(path.join(sourceDir, name), path.join(targetDir, name));
  if (process.platform !== 'win32') await fsp.chmod(binaryPath, 0o755);

  const verified = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' });
  if (verified.status !== 0 || !`${verified.stdout}${verified.stderr}`.includes(`syncthing v${version}`)) {
    throw new Error(`Downloaded Syncthing failed version verification: ${verified.stderr || verified.stdout}`);
  }
  console.log(`${verified.stdout || verified.stderr}`.trim());
} finally {
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
}

async function findSourceDirectory(root, executableName) {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === executableName)) return current;
    for (const entry of entries) if (entry.isDirectory()) queue.push(path.join(current, entry.name));
  }
  return null;
}
