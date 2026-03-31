import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { execFileSync } from 'child_process';
import * as yaml from 'js-yaml';
import { TECHDOCS_DIR, VENV_DIR } from './constants';

interface UtilityConfig {
  os?: Record<string, string | Record<string, string>>;
  arch?: Record<string, string | Record<string, string>>;
  extension?: string | Record<string, string>;
  download?: string;
  extract?: string | Record<string, string>;
  dest?: string;
  perm?: string;
}

interface DownloadUtilitiesYaml {
  versions: Record<string, string>;
  checksums: Record<string, Record<string, Record<string, string> | string>>;
  utility: Record<string, UtilityConfig>;
}

let cachedYaml: DownloadUtilitiesYaml | undefined;

function loadDownloadUtilities(extensionPath: string): DownloadUtilitiesYaml {
  if (cachedYaml) { return cachedYaml; }
  const yamlPath = path.join(extensionPath, 'resources', 'download-utilities.yml');
  const content = fs.readFileSync(yamlPath, 'utf8');
  cachedYaml = yaml.load(content) as DownloadUtilitiesYaml;
  return cachedYaml;
}

function getSystemOs(): string {
  const p = os.platform();
  switch (p) {
    case 'linux': return 'Linux';
    case 'darwin': return 'Darwin';
    case 'win32': return 'Windows';
    default: return p;
  }
}

function getSystemArch(): string {
  const a = os.arch();
  switch (a) {
    case 'x64': return 'x86_64';
    case 'arm64': return 'arm64';
    case 'ia32': return 'i386';
    default: return a;
  }
}

/**
 * Resolve a per-OS/arch field from the YAML using the RESOLVED os/arch
 * names (post-mapping). Follows the yml-install-files precedence:
 * os > arch > default > empty.
 */
function resolveField(
  field: string | Record<string, unknown> | undefined,
  resolvedOs: string,
  resolvedArch: string
): string {
  if (field === undefined || field === null) { return ''; }
  if (typeof field === 'string') { return field; }

  const map = field as Record<string, unknown>;

  const osEntry = map[resolvedOs];
  if (osEntry !== undefined) {
    if (typeof osEntry === 'string') { return osEntry; }
    if (typeof osEntry === 'object' && osEntry !== null) {
      const osArchEntry = (osEntry as Record<string, string>)[resolvedArch];
      if (osArchEntry !== undefined) { return osArchEntry; }
      const osDefault = (osEntry as Record<string, string>)['default'];
      if (osDefault !== undefined) { return osDefault; }
    }
  }

  const archEntry = map[resolvedArch];
  if (archEntry !== undefined) {
    if (typeof archEntry === 'string') { return archEntry; }
  }

  const defaultEntry = map['default'];
  if (defaultEntry !== undefined) {
    if (typeof defaultEntry === 'string') { return defaultEntry; }
    if (typeof defaultEntry === 'object' && defaultEntry !== null) {
      const defArch = (defaultEntry as Record<string, string>)[resolvedArch];
      if (defArch !== undefined) { return defArch; }
      const defDefault = (defaultEntry as Record<string, string>)['default'];
      if (defDefault !== undefined) { return defDefault; }
    }
  }

  return '';
}

function resolveOsName(utility: UtilityConfig, systemOs: string): string {
  if (!utility.os) { return systemOs; }
  const mapped = utility.os[systemOs];
  if (typeof mapped === 'string') { return mapped; }
  if (typeof mapped === 'object' && mapped !== null) {
    return mapped['default'] || systemOs;
  }
  return systemOs;
}

function resolveArchName(utility: UtilityConfig, systemOs: string, systemArch: string): string {
  if (!utility.arch) { return systemArch; }

  const osSpecific = utility.arch[systemOs];
  if (typeof osSpecific === 'object' && osSpecific !== null) {
    const mapped = (osSpecific as Record<string, string>)[systemArch];
    if (mapped) { return mapped; }
  }

  const directMap = utility.arch[systemArch];
  if (typeof directMap === 'string') { return directMap; }

  return systemArch;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const parts = key.split(':-');
    const varName = parts[0].trim();
    const defaultVal = parts.length > 1 ? parts[1].trim() : '';
    return vars[varName] ?? process.env[varName] ?? defaultVal;
  });
}

function httpGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { headers: { 'User-Agent': 'mkdocs-wysiwyg-vscode' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (location) {
          httpGet(location).then(resolve, reject);
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function verifyChecksum(data: Buffer, expected: string): boolean {
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return hash === expected;
}

export function getTechdocsHome(): string {
  return path.join(os.homedir(), TECHDOCS_DIR);
}

export function getVenvPath(): string {
  return path.join(getTechdocsHome(), VENV_DIR);
}

export function getVenvBinDir(): string {
  return path.join(getVenvPath(), os.platform() === 'win32' ? 'Scripts' : 'bin');
}

export function executableName(name: string): string {
  return os.platform() === 'win32' ? `${name}.exe` : name;
}

export function getBinaryPath(name: string): string {
  return path.join(getTechdocsHome(), executableName(name));
}

function resolveChecksum(
  checksums: Record<string, Record<string, Record<string, string> | string>>,
  utilityName: string,
  resolvedOs: string,
  resolvedArch: string
): string | undefined {
  const utilChecksums = checksums[utilityName];
  if (!utilChecksums) { return undefined; }
  const osChecksums = utilChecksums[resolvedOs];
  if (!osChecksums) { return undefined; }
  if (typeof osChecksums === 'string') { return osChecksums; }
  return osChecksums[resolvedArch];
}

/**
 * Detect archive type from the download URL and extract the target binary.
 * Handles tar.gz, zip, and bare binaries without shelling out to bash.
 */
function extractBinary(
  data: Buffer,
  downloadUrl: string,
  utilityName: string,
  dest: string,
  resolvedOs: string,
  resolvedArch: string
): void {
  const binaryName = executableName(utilityName);
  const binaryPath = path.join(dest, binaryName);

  if (downloadUrl.endsWith('.tar.gz') || downloadUrl.endsWith('.tgz')) {
    extractTarGz(data, utilityName, dest, resolvedOs, resolvedArch);
  } else if (downloadUrl.endsWith('.zip')) {
    extractZip(data, binaryName, dest);
  } else {
    fs.writeFileSync(binaryPath, data);
  }

  if (os.platform() !== 'win32' && fs.existsSync(binaryPath)) {
    fs.chmodSync(binaryPath, 0o755);
  }
}

/**
 * Extract a tar.gz archive. Uses the `tar` command which is available on
 * Linux, macOS, and Windows 10+ (bsdtar).
 */
function extractTarGz(
  data: Buffer,
  utilityName: string,
  dest: string,
  resolvedOs: string,
  resolvedArch: string
): void {
  const tmpFile = path.join(os.tmpdir(), `${utilityName}-${Date.now()}.tar.gz`);
  fs.writeFileSync(tmpFile, data);
  try {
    const archivePrefix = `${utilityName}-${resolvedArch}-${resolvedOs}`;
    const targetInArchive = `${archivePrefix}/${utilityName}`;
    const args = ['-xzf', tmpFile, '-C', dest, '--strip-components=1', targetInArchive];
    if (os.platform() !== 'win32') {
      args.push('--no-same-owner');
    }
    execFileSync('tar', args, { stdio: 'pipe' });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
  }
}

/**
 * Extract a zip archive. Uses platform-native tools:
 * - Windows: PowerShell Expand-Archive (available on all modern Windows)
 * - Unix: unzip command
 */
function extractZip(data: Buffer, binaryName: string, dest: string): void {
  const tmpFile = path.join(os.tmpdir(), `download-${Date.now()}.zip`);
  fs.writeFileSync(tmpFile, data);
  try {
    if (os.platform() === 'win32') {
      const tmpExtract = path.join(os.tmpdir(), `extract-${Date.now()}`);
      fs.mkdirSync(tmpExtract, { recursive: true });
      try {
        execFileSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -Path '${tmpFile}' -DestinationPath '${tmpExtract}' -Force`,
        ], { stdio: 'pipe' });
        const extracted = findFileRecursive(tmpExtract, binaryName);
        if (extracted) {
          fs.copyFileSync(extracted, path.join(dest, binaryName));
        } else {
          throw new Error(`${binaryName} not found in zip archive`);
        }
      } finally {
        try { fs.rmSync(tmpExtract, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    } else {
      execFileSync('unzip', ['-o', '-j', '-d', dest, tmpFile, binaryName], { stdio: 'pipe' });
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
  }
}

function findFileRecursive(dir: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, name);
      if (found) { return found; }
    } else if (entry.name === name) {
      return fullPath;
    }
  }
  return undefined;
}

export async function downloadUtility(
  extensionPath: string,
  utilityName: string,
  destDir?: string
): Promise<string> {
  const config = loadDownloadUtilities(extensionPath);
  const utility = config.utility[utilityName];
  if (!utility) { throw new Error(`Unknown utility: ${utilityName}`); }

  const systemOs = getSystemOs();
  const systemArch = getSystemArch();
  const resolvedOs = resolveOsName(utility, systemOs);
  const resolvedArch = resolveArchName(utility, systemOs, systemArch);
  const version = config.versions[utilityName];
  const extension = resolveField(utility.extension, resolvedOs, resolvedArch);
  const dest = destDir ?? getTechdocsHome();

  fs.mkdirSync(dest, { recursive: true });

  const vars: Record<string, string> = {
    version,
    os: resolvedOs,
    arch: resolvedArch,
    extension,
    dest,
    utility: utilityName,
  };

  const downloadUrl = interpolate(utility.download ?? '', vars);
  const expectedChecksum = resolveChecksum(config.checksums, utilityName, resolvedOs, resolvedArch);

  const data = await httpGet(downloadUrl);

  extractBinary(data, downloadUrl, utilityName, dest, resolvedOs, resolvedArch);

  const binaryPath = path.join(dest, executableName(utilityName));

  if (expectedChecksum) {
    const binaryData = fs.readFileSync(binaryPath);
    if (!verifyChecksum(binaryData, expectedChecksum)) {
      fs.unlinkSync(binaryPath);
      throw new Error(`Checksum mismatch for ${utilityName} extracted from ${downloadUrl}`);
    }
  }

  return binaryPath;
}

export function getUtilityVersion(extensionPath: string, utilityName: string): string {
  const config = loadDownloadUtilities(extensionPath);
  return config.versions[utilityName] ?? '';
}
