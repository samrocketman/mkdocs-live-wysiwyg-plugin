import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import * as crypto from 'crypto';
import { ServerInfo, onStateChange, getAllServers } from './server-manager';

const openPreviews = new Set<string>();
let _output: vscode.OutputChannel | undefined;

export function setPreviewOutputChannel(channel: vscode.OutputChannel): void {
  _output = channel;
}

function log(msg: string): void {
  _output?.appendLine(`[preview] ${msg}`);
}

function tcpProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
    sock.setTimeout(2000, () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

function httpProbe(host: string, port: number, probePath: string, method = 'GET'): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: probePath, method, timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Connect to the live-edit WebSocket server the same way a real client does:
 * complete the upgrade, receive the {"action":"connected"} greeting, then
 * send a proper WebSocket close frame so the server logs
 * "disconnected with status OK" rather than "disconnected due to an error".
 */
function wsProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const timer = setTimeout(() => { cleanup(false); }, 2000);
    let settled = false;
    let sock: import('net').Socket | undefined;

    function cleanup(result: boolean) {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      if (sock && !sock.destroyed) { sock.destroy(); }
      resolve(result);
    }

    const req = http.request({
      host, port, path: '/', method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });

    req.on('upgrade', (_res, socket, head) => {
      sock = socket;
      let buf = Buffer.from(head);

      socket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (!tryFinish()) {
          socket.once('data', tryFinish);
        }
      });
      socket.on('error', () => cleanup(false));

      function tryFinish(): boolean {
        const frame = parseWsFrame(buf);
        if (!frame) { return false; }
        try {
          const msg = JSON.parse(frame.payload);
          if (msg.action === 'connected') {
            sendWsClose(socket);
            cleanup(true);
            return true;
          }
        } catch { /* not JSON yet */ }
        return false;
      }

      if (buf.length > 0) { tryFinish(); }
    });

    req.on('response', (res) => { res.resume(); cleanup(false); });
    req.on('error', () => cleanup(false));
    req.end();
  });
}

/** Parse a single WebSocket text frame, returning the UTF-8 payload. */
function parseWsFrame(buf: Buffer): { payload: string; length: number } | null {
  if (buf.length < 2) { return null; }
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buf.length < 4) { return null; }
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) { return null; }
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (masked) { offset += 4; }
  if (buf.length < offset + payloadLen) { return null; }
  let payload = buf.subarray(offset, offset + payloadLen);
  if (masked) {
    const mask = buf.subarray(offset - 4, offset);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) { payload[i] ^= mask[i & 3]; }
  }
  return { payload: payload.toString('utf8'), length: offset + payloadLen };
}

/** Send a WebSocket close frame (opcode 0x8) with status 1000 (normal). */
function sendWsClose(socket: import('net').Socket): void {
  const frame = Buffer.alloc(8);
  frame[0] = 0x88;           // FIN + opcode close
  frame[1] = 0x82;           // MASK + payload length 2
  const mask = crypto.randomBytes(4);
  mask.copy(frame, 2);
  const status = Buffer.alloc(2);
  status.writeUInt16BE(1000); // 1000 = normal closure
  frame[6] = status[0] ^ mask[0];
  frame[7] = status[1] ^ mask[1];
  try { socket.write(frame); } catch { /* socket may already be closing */ }
}

/**
 * Poll until the required servers respond at the application protocol level.
 *   MkDocs HTTP  — HEAD / returns any non-5xx
 *   WebSocket    — full connect, receive {"action":"connected"}, clean close
 *   API server   — TCP connect, best-effort (page knows its own port)
 *
 * MkDocs and WebSocket are required.  The API server check is best-effort
 * because the installed plugin version may not support the ``api_port``
 * config option — in that case the OS picks a random port and the page
 * JavaScript uses the correct port regardless.
 *
 * Each service is probed only until it succeeds once, then skipped.
 * Gives up after ~30 seconds for required services.
 */
async function waitForServers(
  host: string,
  httpPort: number,
  websocketPort: number,
  apiPort: number,
): Promise<void> {
  const MAX_ATTEMPTS = 60;
  const INTERVAL_MS = 500;

  let mkdocsOk = false;
  let wsOk = false;
  let apiOk = false;

  log(`Waiting for servers: mkdocs(:${httpPort}) ws(:${websocketPort}) api(:${apiPort} best-effort)`);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const pending: Promise<void>[] = [];
    if (!mkdocsOk) {
      pending.push(httpProbe(host, httpPort, '/', 'HEAD').then(ok => { if (ok && !mkdocsOk) { mkdocsOk = true; log(`mkdocs(:${httpPort}) ready`); } }));
    }
    if (!wsOk) {
      pending.push(wsProbe(host, websocketPort).then(ok => { if (ok && !wsOk) { wsOk = true; log(`ws(:${websocketPort}) ready`); } }));
    }
    if (!apiOk) {
      pending.push(tcpProbe(host, apiPort).then(ok => { if (ok && !apiOk) { apiOk = true; log(`api(:${apiPort}) ready`); } }));
    }
    await Promise.all(pending);
    if (mkdocsOk && wsOk) {
      if (!apiOk) { log(`api(:${apiPort}) not on expected port (plugin may lack api_port support); proceeding`); }
      log('Required servers ready, opening preview');
      return;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  const notReady = [
    !mkdocsOk && `mkdocs(:${httpPort})`,
    !wsOk && `websocket(:${websocketPort})`,
  ].filter(Boolean).join(', ');
  throw new Error(`Timed out waiting for servers: ${notReady} not ready`);
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

  const { host, httpPort, websocketPort, apiPort } = serverInfo.ports;
  const dirName = path.basename(serverInfo.workspaceDir);

  await waitForServers(host, httpPort, websocketPort, apiPort);

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
