import * as vscode from 'vscode';
import * as path from 'path';
import { getAllServers, onStateChange } from './server-manager';

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBar(): vscode.Disposable {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  updateStatusBar();
  statusBarItem.show();

  const disposable = onStateChange(updateStatusBar);

  return vscode.Disposable.from(statusBarItem, disposable);
}

function updateStatusBar(): void {
  if (!statusBarItem) { return; }

  const servers = getAllServers();
  const running = servers.filter((s) => s.state === 'running');
  const starting = servers.filter((s) => s.state === 'starting');

  if (running.length === 0 && starting.length === 0) {
    statusBarItem.text = '$(circle-outline) MkDocs WYSIWYG';
    statusBarItem.tooltip = 'MkDocs WYSIWYG: No servers running';
    statusBarItem.command = 'mkdocs-wysiwyg.serve';
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (starting.length > 0 && running.length === 0) {
    statusBarItem.text = '$(loading~spin) MkDocs WYSIWYG: Starting...';
    statusBarItem.tooltip = 'MkDocs WYSIWYG: Starting server...';
    statusBarItem.command = undefined;
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (running.length === 1) {
    const s = running[0];
    statusBarItem.text = `$(play-circle) MkDocs: :${s.ports?.httpPort ?? '?'}`;
    statusBarItem.tooltip = `${path.basename(s.workspaceDir)} on ${s.ports?.host}:${s.ports?.httpPort}\nClick for options`;
  } else {
    const ports = running.map((s) => `:${s.ports?.httpPort}`).join(' ');
    statusBarItem.text = `$(play-circle) MkDocs: ${running.length} servers ${ports}`;
    statusBarItem.tooltip = running.map(
      (s) => `${path.basename(s.workspaceDir)} on ${s.ports?.host}:${s.ports?.httpPort}`
    ).join('\n') + '\nClick for options';
  }

  statusBarItem.command = 'mkdocs-wysiwyg.statusBarAction';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
}
