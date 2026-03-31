import * as vscode from 'vscode';
import * as path from 'path';
import { ServerInfo, getAllServers, onStateChange } from './server-manager';

type SidebarItemType = 'server-group' | 'status' | 'action' | 'info';

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly itemType: SidebarItemType,
    collapsible: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    description?: string,
    command?: vscode.Command
  ) {
    super(label, collapsible);
    this.description = description;
    this.command = command;
    this.contextValue = itemType;
  }

  children?: SidebarItem[];
}

export class SidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private disposable: vscode.Disposable;

  constructor() {
    this.disposable = onStateChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this.disposable.dispose();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    if (element?.children) {
      return element.children;
    }

    const servers = getAllServers();
    const items: SidebarItem[] = [];

    if (servers.length === 0) {
      const noServer = new SidebarItem('No servers running', 'status');
      noServer.iconPath = new vscode.ThemeIcon('circle-outline');
      items.push(noServer);

      items.push(new SidebarItem('$(play) Start Server', 'action', undefined, undefined, {
        command: 'mkdocs-wysiwyg.serve',
        title: 'Start Server',
      }));
      items.push(new SidebarItem('$(tools) Build Site', 'action', undefined, undefined, {
        command: 'mkdocs-wysiwyg.build',
        title: 'Build Site',
      }));
      items.push(new SidebarItem('$(add) Initialize Docs', 'action', undefined, undefined, {
        command: 'mkdocs-wysiwyg.init',
        title: 'Initialize Docs',
      }));

      return items;
    }

    for (const server of servers) {
      const group = this.buildServerGroup(server);
      items.push(group);
    }

    items.push(new SidebarItem('$(play) Start Another Server', 'action', undefined, undefined, {
      command: 'mkdocs-wysiwyg.serve',
      title: 'Start Server',
    }));

    return items;
  }

  private buildServerGroup(info: ServerInfo): SidebarItem {
    const label = path.basename(info.workspaceDir);
    const portDesc = info.ports ? `:${info.ports.httpPort}` : '';
    const stateIcon = info.state === 'running' ? 'play-circle'
      : info.state === 'starting' ? 'loading~spin'
      : info.state === 'stopping' ? 'loading~spin'
      : 'circle-outline';

    const group = new SidebarItem(
      label,
      'server-group',
      vscode.TreeItemCollapsibleState.Expanded,
      `${info.state} ${portDesc}`
    );
    group.iconPath = new vscode.ThemeIcon(stateIcon);

    const children: SidebarItem[] = [];

    if (info.state === 'running') {
      children.push(new SidebarItem('$(open-preview) Open Preview', 'action', undefined, undefined, {
        command: 'mkdocs-wysiwyg.openPreview',
        title: 'Open Preview',
      }));
    }

    if (info.ports) {
      children.push(new SidebarItem('HTTP Port', 'info', undefined, String(info.ports.httpPort)));
      children.push(new SidebarItem('WebSocket Port', 'info', undefined, String(info.ports.websocketPort)));
      children.push(new SidebarItem('API Port', 'info', undefined, String(info.ports.apiPort)));
    }

    if (info.startTime) {
      children.push(new SidebarItem('Uptime', 'info', undefined, formatUptime(info.startTime)));
    }

    children.push(new SidebarItem('Directory', 'info', undefined, info.workspaceDir));

    group.children = children;
    return group;
  }
}

function formatUptime(startTime: Date): string {
  const ms = Date.now() - startTime.getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) { return `${hours}h ${minutes % 60}m`; }
  if (minutes > 0) { return `${minutes}m ${seconds % 60}s`; }
  return `${seconds}s`;
}
