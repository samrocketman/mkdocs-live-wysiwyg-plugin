import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, execFileSync, ExecFileException } from 'child_process';
import {
  getTechdocsHome,
  getVenvPath,
  getVenvBinDir,
  getBinaryPath,
  executableName,
  downloadUtility,
} from './platform';
import { WYSIWYG_VERSION, PYTHON_VERSION, PIP_PACKAGES } from './constants';

function uvPath(): string {
  return getBinaryPath('uv');
}

function hasUv(): boolean {
  return fs.existsSync(uvPath());
}

function hasVenv(): boolean {
  return fs.existsSync(getVenvPath());
}

function currentVersionFile(): string {
  return path.join(getTechdocsHome(), 'current');
}

function readCurrentVersion(): string {
  const versionFile = currentVersionFile();
  if (!fs.existsSync(versionFile)) { return ''; }
  return fs.readFileSync(versionFile, 'utf8').trim();
}

function isDevMode(): boolean {
  return readCurrentVersion() === 'dev';
}

function isCurrentVersion(): boolean {
  const installed = readCurrentVersion();
  return installed === WYSIWYG_VERSION || installed === 'dev';
}

function writeCurrentVersion(): void {
  fs.writeFileSync(currentVersionFile(), WYSIWYG_VERSION, 'utf8');
}

function runUv(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(uvPath(), args, { cwd, env: { ...process.env } }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`uv ${args.join(' ')} failed: ${stderr || (err as ExecFileException).message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function runUvSync(args: string[], cwd?: string): string {
  return execFileSync(uvPath(), args, {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
  });
}

export async function ensureEnvironment(
  extensionPath: string,
  output: vscode.OutputChannel,
  progress?: vscode.Progress<{ message?: string }>
): Promise<void> {
  const techdocsHome = getTechdocsHome();
  fs.mkdirSync(techdocsHome, { recursive: true });

  if (!hasUv()) {
    progress?.report({ message: 'Downloading uv...' });
    output.appendLine('Downloading uv...');
    await downloadUtility(extensionPath, 'uv', techdocsHome);
    output.appendLine(`uv installed at ${uvPath()}`);
  }

  if (!hasVenv()) {
    progress?.report({ message: 'Creating Python virtual environment...' });
    output.appendLine(`Creating venv at ${getVenvPath()}...`);
    await runUv(['venv', '--python', PYTHON_VERSION, getVenvPath()]);
    output.appendLine('Virtual environment created.');
  }

  if (isCurrentVersion()) {
    output.appendLine(`Packages already at version ${WYSIWYG_VERSION}, skipping install.`);
    return;
  }

  progress?.report({ message: 'Installing Python packages...' });
  output.appendLine(`Installing packages (${WYSIWYG_VERSION})...`);

  const venvBin = getVenvBinDir();
  const pythonPath = path.join(venvBin, executableName('python'));

  await runUv([
    'pip', 'install',
    '--python', pythonPath,
    ...PIP_PACKAGES,
  ]);

  writeCurrentVersion();
  output.appendLine('All packages installed.');
}

export async function upgradeEnvironment(
  extensionPath: string,
  output: vscode.OutputChannel,
  progress?: vscode.Progress<{ message?: string }>
): Promise<void> {
  if (isDevMode()) {
    output.appendLine('Dev install detected (~/.techdocs/current is "dev"); skipping upgrade.');
    return;
  }

  progress?.report({ message: 'Downloading latest uv...' });
  output.appendLine('Upgrading uv...');
  await downloadUtility(extensionPath, 'uv', getTechdocsHome());

  progress?.report({ message: 'Reinstalling packages...' });
  output.appendLine('Force-reinstalling all packages...');

  const venvBin = getVenvBinDir();
  const pythonPath = path.join(venvBin, executableName('python'));

  await runUv([
    'pip', 'install', '--reinstall',
    '--python', pythonPath,
    ...PIP_PACKAGES,
  ]);

  writeCurrentVersion();
  output.appendLine('Upgrade complete.');
}

export function uninstallEnvironment(output: vscode.OutputChannel): void {
  const techdocsHome = getTechdocsHome();
  if (fs.existsSync(techdocsHome)) {
    fs.rmSync(techdocsHome, { recursive: true, force: true });
    output.appendLine(`Removed ${techdocsHome}`);
  } else {
    output.appendLine('Nothing to uninstall.');
  }
}

export async function addPlugins(
  packages: string[],
  output: vscode.OutputChannel
): Promise<void> {
  if (!hasUv() || !hasVenv()) {
    throw new Error('Environment not set up. Run "MkDocs WYSIWYG: Start Server" first.');
  }
  const venvBin = getVenvBinDir();
  const pythonPath = path.join(venvBin, executableName('python'));
  output.appendLine(`Installing: ${packages.join(', ')}`);
  await runUv(['pip', 'install', '--python', pythonPath, ...packages]);

  for (const pkg of packages) {
    if (pkg.startsWith('-')) { continue; }
    const pluginDir = path.join(pkg, 'mkdocs_live_wysiwyg_plugin');
    try {
      if (fs.statSync(pluginDir).isDirectory()) {
        fs.writeFileSync(currentVersionFile(), 'dev', 'utf8');
        output.appendLine('Local wysiwyg plugin detected; marked as dev install.');
        break;
      }
    } catch { /* not a local directory — skip */ }
  }

  output.appendLine('Plugins installed.');
}

export function getMkdocsPath(): string {
  return path.join(getVenvBinDir(), executableName('mkdocs'));
}
