import * as vscode from 'vscode';
import * as path from 'path';
import * as http from 'http';
import { ServerInfo, onStateChange, getAllServers } from './server-manager';

const openPreviews = new Set<string>();
let _output: vscode.OutputChannel | undefined;

export function setPreviewOutputChannel(channel: vscode.OutputChannel): void {
  _output = channel;
}

function log(msg: string): void {
  _output?.appendLine(`[preview] ${msg}`);
}

interface HealthResponse {
  api: boolean;
  mkdocs: boolean;
  websocket: boolean;
  ready: boolean;
}

/**
 * Poll ``GET /health`` on the API server.  Returns the parsed JSON when
 * ``ready`` is true, or ``null`` when the endpoint is unreachable / not
 * yet ready.
 */
function healthProbe(host: string, apiPort: number): Promise<HealthResponse | null> {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port: apiPort, path: '/health', method: 'GET', timeout: 2000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as HealthResponse;
            resolve(data);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Poll the API server's ``GET /health`` endpoint until all companion
 * services (MkDocs HTTP, WebSocket, API) report ready.  The ``/health``
 * endpoint performs protocol-aware checks server-side (HTTP HEAD for
 * MkDocs, full WebSocket handshake with clean close for the WebSocket
 * server) and returns an aggregate ``ready`` boolean.
 *
 * Gives up after ~30 seconds.
 */
async function waitForServers(
  host: string,
  apiPort: number,
): Promise<void> {
  const MAX_ATTEMPTS = 60;
  const INTERVAL_MS = 500;

  log(`Waiting for servers via /health on api(:${apiPort})`);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const health = await healthProbe(host, apiPort);
    if (health) {
      log(`/health response: api=${health.api} mkdocs=${health.mkdocs} ws=${health.websocket} ready=${health.ready}`);
      if (health.ready) {
        log('All servers ready, opening preview');
        return;
      }
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for servers: /health on :${apiPort} did not report ready`);
}

/**
 * Open the MkDocs preview in VS Code's built-in Simple Browser.
 *
 * Simple Browser handles keyboard events (Ctrl+V paste, etc.), clipboard
 * access, and port forwarding correctly — things that break when using a
 * custom WebView with a cross-origin iframe.
 *
 * Waits for all three servers to respond at the application protocol level
 * before opening the browser.
 */
export async function openPreviewPanel(
  serverInfo: ServerInfo,
  _extensionUri: vscode.Uri
): Promise<void> {
  if (!serverInfo.ports) { return; }

  const { host, httpPort, apiPort } = serverInfo.ports;
  const dirName = path.basename(serverInfo.workspaceDir);

  await waitForServers(host, apiPort);

  const localUri = vscode.Uri.parse(`http://${host}:${httpPort}`);
  const resolvedUri = await vscode.env.asExternalUri(localUri);

  openPreviews.add(serverInfo.workspaceDir);

  await vscode.commands.executeCommand(
    'simpleBrowser.show',
    resolvedUri.toString(),
  );

  const info = `MkDocs: ${dirName} on :${httpPort}`;
  vscode.window.setStatusBarMessage(info, 5000);
}

export function closePreviewPanel(_workspaceDir: string): void {
  openPreviews.delete(_workspaceDir);
}

export function closeAllPreviewPanels(): void {
  openPreviews.clear();
}

export function watchServerState(): vscode.Disposable {
  return onStateChange(() => {
    const running = new Set(
      getAllServers()
        .filter((s) => s.state === 'running' || s.state === 'starting')
        .map((s) => s.workspaceDir)
    );
    for (const dir of openPreviews) {
      if (!running.has(dir)) {
        openPreviews.delete(dir);
      }
    }
  });
}
