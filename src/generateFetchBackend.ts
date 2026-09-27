import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { stringLiteral } from './utils.js';

export interface GenerateFetchBackendOptions {
  /** Output path relative to cwd @default 'src/lib/fetchBackend.ts' */
  outputPath?: string;
  /**
   * Name of the cookie containing the JWT.
   * If configured, it propagates the JWT from the cookie into internal Server-Side API calls.
   */
  cookieName?: string;
  /**
   * HTTP request timeout (in ms).
   * @default 15000
   */
  timeout?: number;
  /**
   * Router the helper is used from. Selects the request/response helpers that are generated
   * (`Request`/`Response` for the App Router, `NextApiRequest`/`NextApiResponse` for the Pages Router).
   * @default 'nextjs'
   */
  framework?: 'nextjs' | 'nextjs-pages';
}

/** Helpers for App Router route handlers (web Request / Response). */
function appRouterHelpers(cookieName?: string) {
  const cookieBlock = cookieName
    ? `
  // Propagate the JWT from the Next.js cookie store when the client didn't send a header
  if (!headers['authorization']) {
    const { cookies } = await import('next/headers');
    const token = (await cookies()).get(${stringLiteral(cookieName)})?.value;
    if (token) headers['authorization'] = \`Bearer \${token}\`;
  }
`
    : '';

  return `
/** Picks the incoming request headers that are forwarded to the backend. */
export async function forwardHeaders(request: Request): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
${cookieBlock}
  return headers;
}

/** Reads the incoming body untouched (JSON, multipart, binary...). Undefined when empty. */
export async function readBody(request: Request): Promise<Buffer | undefined> {
  const body = Buffer.from(await request.arrayBuffer());
  return body.length ? body : undefined;
}

/** Turns a backend response into the Response a route handler returns: status, headers (including Set-Cookie) and body. */
export async function toResponse(response: BackendResponse): Promise<Response> {
  const headers = new Headers();
  for (const [name, value] of response.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name)) headers.set(name, value);
  }
  for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);

  const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
  return new Response(body, { status: response.status, headers });
}
`;
}

/** Helpers for Pages Router API routes (NextApiRequest / NextApiResponse). */
function pagesRouterHelpers(cookieName?: string) {
  const cookieBlock = cookieName
    ? `
  // Propagate the JWT from the request cookie when the client didn't send a header
  const token = req.cookies?.[${stringLiteral(cookieName)}];
  if (!headers['authorization'] && token) headers['authorization'] = \`Bearer \${token}\`;
`
    : '';

  return `
/** Picks the incoming request headers that are forwarded to the backend. */
export function forwardHeaders(req: NextApiRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
${cookieBlock}
  return headers;
}

/** Reads the raw body (the generated API routes disable Next's bodyParser). Undefined when empty. */
export function readBody(req: NextApiRequest): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      resolve(body.length ? body : undefined);
    });
    req.on('error', reject);
  });
}

/** Sends a backend response through an API route: status, headers (including Set-Cookie) and body. */
export async function sendResponse(res: NextApiResponse, response: BackendResponse): Promise<void> {
  for (const [name, value] of response.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name)) res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);

  res.status(response.status);
  if (NULL_BODY_STATUSES.has(response.status)) {
    res.end();
  } else {
    res.end(Buffer.from(await response.arrayBuffer()));
  }
}
`;
}

/**
 * Generates fetchBackend.ts — the server-side HTTP client used by the generated route handlers.
 *
 * This file:
 *  - Calls the backend with axios (supports BACKEND_IGNORE_SSL in development).
 *  - Returns a fetch-like response that keeps the raw bytes, so JSON, files and text are proxied untouched.
 *  - Exposes forwardHeaders / readBody / toResponse (App Router) or sendResponse (Pages Router),
 *    which the route handlers use to pass requests and responses through — including Set-Cookie.
 *  - Propagates the JWT cookie as a Bearer token when cookieName is set.
 */
export function generateFetchBackend({
  outputPath = 'src/lib/fetchBackend.ts',
  cookieName,
  timeout = 15_000,
  framework = 'nextjs',
}: GenerateFetchBackendOptions, cwd: string): string {
  const isPages = framework === 'nextjs-pages';

  const content = `// Auto-generated by codegen-openapi — do not edit manually
import 'server-only';
import axios from 'axios';
import https from 'node:https';
${isPages ? `import type { NextApiRequest, NextApiResponse } from 'next';\n` : ''}
const httpsAgent =
  process.env.BACKEND_IGNORE_SSL === 'true'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

/**
 * Client request headers passed on to the backend. x-forwarded-for / x-real-ip keep the real
 * client IP (Next.js fills x-forwarded-for when a reverse proxy hasn't), so per-IP rate limits
 * and logs on the backend don't see every user as the Next.js server. The backend must trust
 * only the proxy hops in front of it (e.g. Express 'trust proxy'), otherwise the IP is spoofable.
 */
const FORWARDED_REQUEST_HEADERS = [
  'authorization', 'content-type', 'accept', 'accept-language',
  'user-agent', 'x-forwarded-for', 'x-real-ip',
];

/** Connection-level headers that must not be copied from the backend response. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'content-encoding',
  'upgrade', 'te', 'trailer', 'proxy-authenticate', 'proxy-authorization',
]);

/** Statuses that must be sent without a body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export interface FetchBackendOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface BackendResponse {
  ok: boolean;
  status: number;
  headers: {
    get(name: string): string | null;
    entries(): [string, string][];
    getSetCookie(): string[];
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Performs an HTTP request to the backend from a Route Handler, API route or Server Component.
 * Returns a fetch-like response; the body is kept as raw bytes.
 */
export async function fetchBackend(
  url: string,
  { method = 'GET', headers = {}, body }: FetchBackendOptions = {},
): Promise<BackendResponse> {
  const response = await axios({
    url,
    method,
    headers,
    data: body,
    httpsAgent,
    timeout: ${timeout},
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });

  const data = Buffer.from(response.data ?? []);
  const headerEntries: [string, string][] = [];
  const setCookie: string[] = [];
  for (const [name, value] of Object.entries(response.headers)) {
    if (value == null) continue;
    const key = name.toLowerCase();
    if (key === 'set-cookie') {
      setCookie.push(...(Array.isArray(value) ? value : [String(value)]));
    } else {
      headerEntries.push([key, Array.isArray(value) ? value.join(', ') : String(value)]);
    }
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    headers: {
      get: (name) => headerEntries.find(([key]) => key === name.toLowerCase())?.[1] ?? null,
      entries: () => headerEntries,
      getSetCookie: () => setCookie,
    },
    json: async () => JSON.parse(data.toString('utf-8')),
    text: async () => data.toString('utf-8'),
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  };
}
${isPages ? pagesRouterHelpers(cookieName) : appRouterHelpers(cookieName)}`;

  const absolutePath = join(cwd, outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
  return outputPath;
}
