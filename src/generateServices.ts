import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildPathTree,
  toNextPathWithTree,
  buildParamMap,
  slugifyTag,
  extractOperations,
  fetchSpec,
  resolveRef,
  refName,
  isNullable,
  primaryType,
  getSuccessResponseSchema,
  groupByTag,
  assignOperationNames,
  propertyKey,
  stringLiteral,
  jsDoc,
  relativeImport,
  GENERATED_HEADER,
  type OperationNames,
  type PathTreeNode,
} from './utils.js';
import { escapeTemplate } from './generateRoutes.js';

// ─── $ref collection ──────────────────────────────────────────────────────────

/**
 * Collects all $refs from a schema in post-order (dependencies first).
 * Incorporates a depth guard mechanism to prevent infinite loops in circular specifications.
 */
function collectRefs(
  schema: any,
  spec: any,
  result = new Map<string, string>(),
  visited = new Set<string>(),
  depth = 0,
): Map<string, string> {
  if (!schema || typeof schema !== 'object' || depth > 20) return result;

  if (schema.$ref) {
    if (!visited.has(schema.$ref) && schema.$ref.startsWith('#/components/')) {
      visited.add(schema.$ref);
      const resolved = resolveRef(schema.$ref, spec);
      collectRefs(resolved, spec, result, visited, depth + 1);
      result.set(schema.$ref, refName(schema.$ref));
    }
    return result;
  }

  for (const v of Object.values(schema.properties ?? {})) collectRefs(v, spec, result, visited, depth + 1);
  if (schema.items) collectRefs(schema.items, spec, result, visited, depth + 1);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    collectRefs(schema.additionalProperties, spec, result, visited, depth + 1);
  }
  for (const s of [
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ]) {
    collectRefs(s, spec, result, visited, depth + 1);
  }
  return result;
}

// ─── Schema → TypeScript ──────────────────────────────────────────────────────

/**
 * Converts an OpenAPI JSON Schema into a standalone TypeScript string representation.
 *
 * It natively supports:
 * - $refs with built-in cyclic depth prevention.
 * - allOf / oneOf / anyOf composition handlers.
 * - Nullability validation via `nullable: true` (OAS 3.0) and multi-types `['string', 'null']` (OAS 3.1).
 * - Enums, typed arrays, nested objects, conditional string typing, and property constraints.
 * - additionalProperties arbitrary mapping (`Record<string, unknown>`).
 */
function schemaToTs(schema: any, spec: any, indent = 0, visited = new Set<string>()): string {
  if (!schema) return 'unknown';

  // Handling cyclic component references
  if (schema.$ref) {
    if (visited.has(schema.$ref)) return 'unknown /* circular reference */';
    return refName(schema.$ref);
  }

  const pad = '  '.repeat(indent);
  const child = '  '.repeat(indent + 1);
  const nullable = isNullable(schema) ? ' | null' : '';
  const type = primaryType(schema) ?? schema.type;

  // allOf might wrap a direct $ref (e.g. { allOf: [{ $ref: '...' }] })
  // Here we normalize it by dropping intersection if not needed
  if (schema.allOf?.length) {
    if (schema.allOf.length === 1 && schema.allOf[0].$ref) {
      return refName(schema.allOf[0].$ref) + nullable;
    }
    const parts = schema.allOf.map((s: any) => schemaToTs(s, spec, indent, new Set(visited)));
    return parts.join(' & ') + nullable;
  }

  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) {
    const parts = union
      .filter((s: any) => !(Array.isArray(s.type) ? s.type : [s.type]).includes('null'))
      .map((s: any) => schemaToTs(s, spec, indent, new Set(visited)));
    const hasNullVariant = union.some((s: any) =>
      (Array.isArray(s.type) ? s.type : [s.type]).includes('null'),
    );
    if (!parts.length) return 'null';
    return parts.join(' | ') + (hasNullVariant ? ' | null' : '') + nullable;
  }

  if (type === 'array' || schema.items) {
    const item = schema.items ? schemaToTs(schema.items, spec, indent, new Set(visited)) : 'unknown';
    // (A | B)[] — without parentheses `A | B[]` would mean something else
    const wrapped = /[|&]/.test(item) && !item.startsWith('{') ? `(${item})` : item;
    return `${wrapped}[]${nullable}`;
  }

  if (type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(schema.properties ?? {});

    if (!entries.length) {
      const addProps = schema.additionalProperties;
      if (addProps === true || addProps == null) return `Record<string, unknown>${nullable}`;
      if (typeof addProps === 'object') {
        const valType = schemaToTs(addProps, spec, indent, new Set(visited));
        return `Record<string, ${valType}>${nullable}`;
      }
      return `{}${nullable}`;
    }

    const props = entries.map(([key, s]: [string, any]) => {
      const propType = schemaToTs(s, spec, indent + 1, new Set(visited));
      const opt = required.has(key) ? '' : '?';
      const doc = s?.description ? jsDoc(s.description, child) : '';
      return `\n${doc}${child}${propertyKey(key)}${opt}: ${propType};`;
    });
    return `{${props.join('')}\n${pad}}${nullable}`;
  }

  if (schema.enum?.length) {
    return (
      schema.enum
        .map((v: any) => (typeof v === 'string' ? stringLiteral(v) : String(v)))
        .join(' | ') + nullable
    );
  }

  switch (type) {
    // format: binary is a file (multipart upload field) — File extends Blob
    case 'string': return schema.format === 'binary' ? `Blob${nullable}` : `string${nullable}`;
    case 'number':
    case 'integer': return `number${nullable}`;
    case 'boolean': return `boolean${nullable}`;
    default: return `unknown${nullable}`;
  }
}

// ─── Extract schemas grouped by operation ─────────────────────────────────────

/**
 * True when the body is sent as multipart/form-data: the operation accepts it and has no JSON
 * alternative (getSchemasForOp prefers JSON when both exist).
 */
export function isMultipartBody(op: any): boolean {
  const content = op?._raw?.requestBody?.content ?? {};
  return !content['application/json'] && !!content['multipart/form-data'];
}

function getSchemasForOp(op: any) {
  const raw = op._raw;

  // requestBody — resolves multiplexing content types like FormData & Json buffers natively
  const reqContent =
    raw?.requestBody?.content?.['application/json']?.schema ??
    raw?.requestBody?.content?.['multipart/form-data']?.schema ??
    raw?.requestBody?.content?.['application/x-www-form-urlencoded']?.schema ??
    raw?.requestBody?.content?.['*/*']?.schema ??
    null;

  // response schema extraction using the robust 2xx helper
  const resContent = getSuccessResponseSchema(raw?.responses ?? {});

  // query parameters grouping mapped into standard Object schema shape
  const queryParams = (raw?.parameters ?? []).filter((p: any) => p.in === 'query');
  const querySchema =
    queryParams.length > 0
      ? {
        type: 'object',
        properties: Object.fromEntries(
          queryParams.map((p: any) => [
            p.name,
            { ...(p.schema ?? { type: 'string' }), description: p.description },
          ]),
        ),
        required: queryParams.filter((p: any) => p.required).map((p: any) => p.name),
      }
      : null;

  return { reqSchema: reqContent, resSchema: resContent, querySchema };
}

// ─── Aliases ──────────────────────────────────────────────────────────────────

/** Names are assigned per service file by assignOperationNames() and attached to each op. */
function getAliases(op: any): OperationNames {
  return op.names;
}

// ─── Types file renderer ──────────────────────────────────────────────────────

function tsBlock(name: string, tsStr: string) {
  return `export type ${name} = ${tsStr};`;
}

function renderTypesFile({ operations, spec }: any) {
  const allRefs = new Map<string, string>();
  for (const op of operations) {
    const { reqSchema, resSchema, querySchema } = getSchemasForOp(op);
    for (const s of [reqSchema, resSchema, querySchema]) {
      if (s) collectRefs(s, spec, allRefs);
    }
  }

  const lines = ['// Auto-generated by codegen-openapi — do not edit manually'];

  if (allRefs.size > 0) {
    lines.push('', '// ─── Shared schemas ─────────────────────────────────────────────────────────');
    for (const [refPath, name] of allRefs) {
      const schema = resolveRef(refPath, spec);
      if (!schema) continue;
      const ts = schemaToTs(schema, spec);
      lines.push('', tsBlock(name, ts));
    }
  }

  lines.push('', '// ─── Operation types ────────────────────────────────────────────────────────');
  for (const op of operations) {
    const { aliasResponse, aliasBody, aliasParams } = getAliases(op);
    const { reqSchema, resSchema, querySchema } = getSchemasForOp(op);

    lines.push('');
    const resTs = resSchema ? schemaToTs(resSchema, spec) : 'unknown';
    lines.push(`/** ${op.method} ${op.path} — response */`);
    lines.push(tsBlock(aliasResponse, resTs));

    if (aliasBody) {
      let bodyTs = reqSchema ? schemaToTs(reqSchema, spec) : 'unknown';
      // Multipart bodies also accept a ready-made FormData (e.g. built from a <form>)
      if (isMultipartBody(op)) bodyTs += ' | FormData';
      lines.push(`/** ${op.method} ${op.path} — payload */`);
      lines.push(tsBlock(aliasBody, bodyTs));
    }

    if (aliasParams && querySchema) {
      const paramsTs = schemaToTs(querySchema, spec);
      lines.push(`/** ${op.method} ${op.path} — query params */`);
      lines.push(tsBlock(aliasParams, paramsTs));
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Service file renderer ────────────────────────────────────────────────────

/**
 * Maps the routes output directory to the URL the browser calls.
 * e.g., 'src/app/api' → '/api', 'app/api' → '/api', 'src/pages/api' → '/api',
 *       'apps/web/src/app/(public)/api' → '/api' (route groups are not part of the URL)
 */
export function routesOutToUrlBase(routesOut: string, framework?: string): string {
  if (framework === 'react') return '';
  const segs = routesOut.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  let rootIdx = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i] === 'app' || segs[i] === 'pages') { rootIdx = i; break; }
  }
  const urlSegs = segs
    .slice(rootIdx + 1)
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('@'));
  return urlSegs.length ? '/' + urlSegs.join('/') : '';
}

/**
 * TS expression for a backend base URL read from the environment at runtime.
 * VITE_* variables use import.meta.env; others use process.env (guarded for browser bundles).
 */
export function baseUrlExpression({ env, fallback }: { env: string; fallback?: string }) {
  const read = env.startsWith('VITE_')
    ? `import.meta.env.${env}`
    : `(typeof process !== 'undefined' ? process.env.${env} : undefined)`;
  return `${read} || ${stringLiteral(fallback ?? '')}`;
}

function renderServiceFile({ varName, operations, apiClientImport, tree, urlBase, baseUrl }: any) {
  const typeNames: string[] = [];
  for (const op of operations) {
    const { aliasResponse, aliasBody, aliasParams } = getAliases(op);
    typeNames.push(aliasResponse);
    if (aliasBody) typeNames.push(aliasBody);
    if (aliasParams) typeNames.push(aliasParams);
  }

  const methods = operations.map((op: any) => renderMethod(op, tree, urlBase, !!baseUrl)).join('\n\n');
  const baseUrlLine = baseUrl
    ? `\n/** Backend base URL — set ${baseUrl.env} to override. */\nconst BASE_URL = ${baseUrlExpression(baseUrl)};\n`
    : '';

  return `// Auto-generated by codegen-openapi — do not edit manually
import apiClient from '${apiClientImport}';
import type { ${typeNames.join(', ')} } from './types';
${baseUrlLine}
const ${varName} = {
${methods}
};

export default ${varName};
`;
}

function renderMethod(op: any, tree: PathTreeNode, urlBase: string, withBaseUrl = false) {
  const { methodName, aliasResponse, aliasBody, aliasParams } = getAliases(op);
  const { method, path, pathParams, hasBody, summary } = op;

  // Use tree-based canonical param names for cross-path consistency with generated routes
  const paramMap = buildParamMap(path, tree);
  const canonicalParams: string[] = pathParams.map((p: string) => paramMap[p] ?? p);

  const nextPath = toNextPathWithTree(path, tree);
  const urlExpr = canonicalParams.reduce(
    (u: string, p: string) => u.replace(`[${p}]`, `\${${p}}`),
    nextPath,
  );

  const urlStr = withBaseUrl
    ? `\`\${BASE_URL}${escapeTemplate(urlBase)}${urlExpr}\``
    : canonicalParams.length > 0 ? `\`${urlBase}${urlExpr}\`` : `'${urlBase}${urlExpr}'`;

  const args: string[] = [];
  canonicalParams.forEach((p: string) => args.push(`${p}: string`));
  if (aliasBody) args.push(`body: ${aliasBody}`);
  if (aliasParams) args.push(`params: ${aliasParams} = {} as ${aliasParams}`);

  // Multipart: postForm/putForm/patchForm turn a plain object into FormData (a FormData is sent
  // as-is). indexes: null repeats the key for arrays (photos=a, photos=b), which is what upload
  // middlewares like multer expect — axios' default would send photos[]
  const multipart = hasBody && isMultipartBody(op) && ['POST', 'PUT', 'PATCH'].includes(method);
  const axiosMethod = multipart ? `${method.toLowerCase()}Form` : method.toLowerCase();

  // Axios signatures: get/delete(url, config) — post/put/patch(url, data, config)
  const config: string[] = [];
  if (aliasParams) config.push('params');
  if (multipart) config.push('formSerializer: { indexes: null }');
  const callArgs = [urlStr];
  if (method === 'GET' || method === 'DELETE') {
    if (hasBody) config.push('data: body');
    if (config.length) callArgs.push(`{ ${config.join(', ')} }`);
  } else {
    if (hasBody || config.length) callArgs.push(hasBody ? 'body' : 'undefined');
    if (config.length) callArgs.push(`{ ${config.join(', ')} }`);
  }

  const comment = summary ? jsDoc(summary, '  ') : '';

  return `${comment}  async ${methodName}(${args.join(', ')}): Promise<${aliasResponse}> {
    const { data } = await apiClient.${axiosMethod}(${callArgs.join(', ')});
    return data;
  },`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function generateServices({
  spec,
  stripPathPrefix,
  servicesOut,
  apiClientPath,
  apiClientFile = 'src/lib/apiClient.ts',
  routesOut,
  framework,
  baseUrl,
  backendPrefix = '',
  barrel = false,
  cwd,
}: any) {
  const parsed = typeof spec === 'string' ? await fetchSpec(spec) : spec;
  const operations = extractOperations(parsed, { stripPathPrefix });

  // Next.js: services call the generated routes (/api/...). React with baseUrl: they call the
  // backend directly with the full spec path. React without baseUrl (legacy): relative paths.
  const urlBase = baseUrl ? backendPrefix : routesOutToUrlBase(routesOut ?? 'src/app/api', framework);

  // Build tree once from all paths for cross-path canonical param consistency
  const tree = buildPathTree(operations.map((op: any) => op.path));

  const files: string[] = [];
  const services: { slug: string; varName: string }[] = [];

  for (const [tag, tagOps] of groupByTag(operations)) {
    const names = assignOperationNames(tagOps, parsed);
    const ops = tagOps.map((op: any, i: number) => ({ ...op, names: names[i] }));

    const slug = slugifyTag(tag);
    const varName =
      slug
        .split('-')
        .map((w: string, i: number) =>
          i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1),
        )
        .join('') + 'Service';

    mkdirSync(join(cwd, servicesOut, slug), { recursive: true });

    const typesFile = join(servicesOut, slug, 'types.ts');
    writeFileSync(join(cwd, typesFile), renderTypesFile({ operations: ops, spec: parsed }), 'utf-8');
    files.push(typesFile);

    // An explicit apiClientPath wins (e.g. an alias like '@/lib/apiClient'); otherwise import relatively
    const apiClientImport = apiClientPath ?? relativeImport(join(servicesOut, slug), apiClientFile);

    const indexFile = join(servicesOut, slug, 'index.ts');
    writeFileSync(
      join(cwd, indexFile),
      renderServiceFile({ varName, operations: ops, apiClientImport, tree, urlBase, baseUrl }),
      'utf-8',
    );
    files.push(indexFile);
    services.push({ slug, varName });
  }

  // <servicesOut>/index.ts: import every service (and its types namespace) from one place
  if (barrel) {
    const barrelFile = join(servicesOut, 'index.ts');
    const lines = services.map(({ slug, varName }) =>
      `export { default as ${varName} } from './${slug}';\n` +
      `export type * as ${varName.replace(/Service$/, '')}Types from './${slug}/types';`);
    writeFileSync(join(cwd, barrelFile), `${GENERATED_HEADER}\n${lines.join('\n')}\n`, 'utf-8');
    files.push(barrelFile);
  }

  return files;
}
