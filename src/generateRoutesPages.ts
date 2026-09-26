import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import {
  buildPathTree,
  toNextPathWithTree,
  buildParamMap,
  extractOperations,
  fetchSpec,
  lineComment,
  relativeImport,
  stringLiteral,
} from './utils.js';

function buildBackendUrl(path: string, paramMap: Record<string, string>) {
  const withParams = path.replace(/\{(\w+)\}/g, (_, p) => `\${${paramMap[p] ?? p}}`);
  return `\`\${API_URL}${withParams}\``;
}

function renderMethodBlock(op: any, { apiEnvVar, apiFallback }: any, rawBody: boolean) {
  const { method, path, hasBody, hasQueryParams, summary, paramMap } = op;

  const lines: string[] = [];
  if (summary) lines.push(`  // ${lineComment(summary)}`);
  lines.push(`  if (req.method === '${method}') {`);
  lines.push(`    const API_URL = process.env.${apiEnvVar} || '${apiFallback}';`);
  lines.push('');

  const backendUrl = buildBackendUrl(path, paramMap);
  if (hasQueryParams) {
    lines.push(`    const qs = new URLSearchParams(queryRest as Record<string, string>).toString();`);
    lines.push(`    const url = qs ? \`${backendUrl.slice(1, -1)}?\${qs}\` : ${backendUrl};`);
  } else {
    lines.push(`    const url = ${backendUrl};`);
  }
  lines.push('');

  const fetchOpts: string[] = [`method: '${method}'`, 'headers'];
  if (hasBody && rawBody) {
    // bodyParser is disabled for this file (multipart): forward the raw bytes with the original
    // Content-Type so the multipart boundary is preserved
    lines.push(`    const body = await readRawBody(req);`);
    lines.push(`    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];`);
    fetchOpts.push('body: body.length ? body : undefined');
  } else if (hasBody) {
    lines.push(`    const hasBody = req.body !== undefined && req.body !== '';`);
    lines.push(`    if (hasBody) headers['Content-Type'] = 'application/json';`);
    fetchOpts.push(`body: hasBody ? JSON.stringify(req.body) : undefined`);
  }

  lines.push(`    const response = await fetchBackend(url, { ${fetchOpts.join(', ')} });`);
  lines.push('');
  lines.push(`    if (response.status === 204 || response.status === 205 || response.status === 304) {`);
  lines.push(`      return res.status(response.status).end();`);
  lines.push(`    }`);
  lines.push('');
  lines.push(`    let data: any;`);
  lines.push(`    const contentType = response.headers.get('content-type') ?? '';`);
  lines.push(`    if (contentType.includes('application/json')) {`);
  lines.push(`      data = await response.json();`);
  lines.push(`    } else {`);
  lines.push(`      data = await response.text();`);
  lines.push(`    }`);
  lines.push('');
  lines.push(`    if (!response.ok) {`);
  lines.push(`      return res.status(response.status).json({ success: false, message: data?.message ?? 'Request encountered an error' });`);
  lines.push(`    }`);
  lines.push(`    return res.status(response.status).json(data);`);
  lines.push(`  }`);

  return lines.join('\n');
}

function renderPagesHandler({ operations, apiEnvVar, apiFallback, fetchBackendImport, cookieName }: any) {
  const summaries = operations
    .map((op: any) => `// ${op.method} ${op.path}${op.summary ? ` — ${lineComment(op.summary)}` : ''}`)
    .join('\n');

  // Collect unique canonical path param names across all ops in this file
  const fileParamNames: string[] = [];
  const seen = new Set<string>();
  for (const op of operations) {
    for (const p of op.pathParams) {
      const canonical = op.paramMap[p] ?? p;
      if (!seen.has(canonical)) {
        seen.add(canonical);
        fileParamNames.push(canonical);
      }
    }
  }

  const hasFileQueryParams = operations.some((op: any) => op.hasQueryParams);

  // Next's bodyParser can't parse multipart; disable it for the whole file and stream bodies through
  const rawBody = operations.some((op: any) => op.hasBody && op.bodyContentType === 'multipart/form-data');

  // Build destructuring line at the top of handler
  let queryDestructure = '';
  if (fileParamNames.length > 0 && hasFileQueryParams) {
    const typeEntries = fileParamNames.map((p) => `${p}: string`).join('; ');
    queryDestructure = `    const { ${fileParamNames.join(', ')}, ...queryRest } = req.query as { ${typeEntries}; [key: string]: string | string[] };\n`;
  } else if (fileParamNames.length > 0) {
    const typeEntries = fileParamNames.map((p) => `${p}: string`).join('; ');
    queryDestructure = `    const { ${fileParamNames.join(', ')} } = req.query as { ${typeEntries} };\n`;
  } else if (hasFileQueryParams) {
    queryDestructure = `    const queryRest = req.query as Record<string, string>;\n`;
  }

  const methodBlocks = operations
    .map((op: any) => renderMethodBlock(op, { apiEnvVar, apiFallback }, rawBody))
    .join('\n\n')
    .replace(/^(?=.)/gm, '  ');

  // next/headers cookies() only works in the App Router, so the Pages handler forwards the cookie itself
  const cookieBlock = cookieName
    ? `
    const token = req.cookies?.[${stringLiteral(cookieName)}];
    if (!authHeader && token) {
      headers['Authorization'] = \`Bearer \${token}\`;
    }`
    : '';

  const rawBodyHelpers = rawBody
    ? `
export const config = { api: { bodyParser: false } };

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
`
    : '';

  return `// Auto-generated by codegen-openapi — do not edit manually
import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchBackend } from '${fetchBackendImport}';

${summaries}
${rawBodyHelpers}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authHeader = req.headers.authorization as string | undefined;
    const headers: Record<string, string> = {};
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }${cookieBlock}
${queryDestructure ? '\n' + queryDestructure : ''}
${methodBlocks}

    res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (error) {
    console.error('[handler]', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}
`;
}

/**
 * Converts a Next.js path (e.g. /users/[id]/posts) to a Pages Router file path.
 * /users/[id] → users/[id].ts
 * /users      → users.ts
 * /users/[id]/posts → users/[id]/posts.ts
 */
export function nextPathToPageFilePath(nextPath: string): string {
  const segs = nextPath.split('/').filter(Boolean);
  if (segs.length === 0) return 'index.ts';
  const last = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  return [...dirs, last + '.ts'].join('/');
}

export async function generateRoutesPages({
  spec,
  stripPathPrefix,
  apiEnvVar,
  apiFallback,
  routesOut,
  cookieName,
  fetchBackendPath,
  fetchBackendFile = 'src/lib/fetchBackend.ts',
  cwd,
}: any) {
  const parsed     = typeof spec === 'string' ? await fetchSpec(spec) : spec;
  const operations = extractOperations(parsed, { stripPathPrefix });
  const tree       = buildPathTree(operations.map((op: any) => op.path));

  // Group operations by output file (multiple methods → one handler file)
  const byFile = new Map<string, any[]>();
  for (const op of operations) {
    const nextPath = toNextPathWithTree(op.path, tree);
    const fileKey  = nextPathToPageFilePath(nextPath);
    if (!byFile.has(fileKey)) byFile.set(fileKey, []);
    byFile.get(fileKey)!.push({ ...op, paramMap: buildParamMap(op.path, tree) });
  }

  const files: string[] = [];

  for (const [fileRelative, ops] of byFile) {
    const relativePath = join(routesOut, fileRelative);
    const absolutePath = join(cwd, relativePath);
    // An explicit fetchBackendPath wins (e.g. '@/lib/fetchBackend'); otherwise import relatively
    const fetchBackendImport = fetchBackendPath ?? relativeImport(dirname(relativePath), fetchBackendFile);
    const content      = renderPagesHandler({ operations: ops, apiEnvVar, apiFallback, fetchBackendImport, cookieName });

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf-8');
    files.push(relativePath);
  }

  return files;
}
