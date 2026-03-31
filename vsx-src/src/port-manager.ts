import * as net from 'net';
import { DEFAULT_HOST, DEFAULT_HTTP_PORT, DEFAULT_WEBSOCKET_PORT, DEFAULT_API_PORT, MAX_PORT_RETRIES } from './constants';

function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function randomUserPort(): number {
  return Math.floor(Math.random() * 64511) + 1024;
}

async function resolvePort(host: string, preferred: number, exclude: Set<number>): Promise<number> {
  if (!exclude.has(preferred) && await isPortAvailable(host, preferred)) {
    return preferred;
  }
  for (let i = 0; i < MAX_PORT_RETRIES; i++) {
    const port = randomUserPort();
    if (!exclude.has(port) && await isPortAvailable(host, port)) {
      return port;
    }
  }
  throw new Error(`Could not find an available port after ${MAX_PORT_RETRIES} attempts.`);
}

export interface ResolvedPorts {
  host: string;
  httpPort: number;
  websocketPort: number;
  apiPort: number;
}

export async function resolvePorts(host?: string): Promise<ResolvedPorts> {
  const h = host ?? process.env['TECHDOCS_HOST'] ?? DEFAULT_HOST;
  const claimed = new Set<number>();

  const httpPort = await resolvePort(h, DEFAULT_HTTP_PORT, claimed);
  claimed.add(httpPort);

  const websocketPort = await resolvePort(h, DEFAULT_WEBSOCKET_PORT, claimed);
  claimed.add(websocketPort);

  const apiPort = await resolvePort(h, DEFAULT_API_PORT, claimed);

  return { host: h, httpPort, websocketPort, apiPort };
}
