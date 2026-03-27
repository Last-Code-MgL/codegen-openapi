import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  toNextPath,
  operationIdToMethodName,
  slugifyTag,
  extractOperations,
  fetchSpec,
  resolveRef,
  refName,
  isNullable,
  primaryType,
  getSuccessResponseSchema,
} from './utils.js';

// ─── $ref collection ──────────────────────────────────────────────────────────

/**
 * Coleta todos os $refs de um schema em post-order (dependências antes de quem usa).
 * Tem guard de profundidade para evitar loops em specs circulares.
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
 * Converte um JSON Schema OpenAPI → string TypeScript.
 *
 * Suporta:
 * - $ref com guard anti-ciclo
 * - allOf / oneOf / anyOf
 * - nullable via `nullable: true` (OAS 3.0) e `type: ['string','null']` (OAS 3.1)
 * - enums, arrays, objects com propriedades opcionais
 * - additionalProperties
 */
function schemaToTs(schema: any, spec: any, indent = 0, visited = new Set<string>()): string {
  if (!schema) return 'unknown';

  // $ref — se já foi visitado nesse branch, evita ciclo com `unknown`
  if (schema.$ref) {
    if (visited.has(schema.$ref)) return 'unknown /* circular */';
    return refName(schema.$ref);
  }

  const pad   = '  '.repeat(indent);
  const child = '  '.repeat(indent + 1);
  const nullable = isNullable(schema) ? ' | null' : '';
  const type = primaryType(schema) ?? schema.type;

  // allOf: pode ser um wrapper de $ref (ex: { allOf: [{ $ref: '...' }] })
  // Nesse caso simplificamos para o nome do ref em vez de gerar interseção
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
    return parts.join(' | ') + (hasNullVariant ? ' | null' : '') + nullable;
  }

  if (type === 'array' || schema.items) {
    const item = schema.items ? schemaToTs(schema.items, spec, indent, new Set(visited)) : 'unknown';
    return `${item}[]${nullable}`;
  }

  if (type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? []);
    const entries  = Object.entries(schema.properties ?? {});

    if (!entries.length) {
      const addProps = schema.additionalProperties;
      if (addProps === true || addProps == null)  return `Record<string, unknown>${nullable}`;
      if (typeof addProps === 'object') {
        const valType = schemaToTs(addProps, spec, indent, new Set(visited));
        return `Record<string, ${valType}>${nullable}`;
      }
      return `{}${nullable}`;
    }

    const props = entries.map(([key, s]: [string, any]) => {
      const propType = schemaToTs(s, spec, indent + 1, new Set(visited));
      const opt      = required.has(key) ? '' : '?';
      const comment  = s.description ? `\n${child}/** ${s.description} */` : '';
      return `${comment}\n${child}${key}${opt}: ${propType};`;
    });
    return `{${props.join('')}\n${pad}}${nullable}`;
  }

  if (schema.enum?.length) {
    return (
      schema.enum
        .map((v: any) => (typeof v === 'string' ? `'${v}'` : String(v)))
        .join(' | ') + nullable
    );
  }

  switch (type) {
    case 'string':  return `string${nullable}`;
    case 'number':
    case 'integer': return `number${nullable}`;
    case 'boolean': return `boolean${nullable}`;
    default:        return `unknown${nullable}`;
  }
}

// ─── Schemas por operação ─────────────────────────────────────────────────────

function getSchemasForOp(op: any) {
  const raw = op._raw;

  // requestBody — suporta multipart/form-data e outros content-types além de JSON
  const reqContent =
    raw?.requestBody?.content?.['application/json']?.schema ??
    raw?.requestBody?.content?.['multipart/form-data']?.schema ??
    raw?.requestBody?.content?.['application/x-www-form-urlencoded']?.schema ??
    raw?.requestBody?.content?.['*/*']?.schema ??
    null;

  // response — usa helper robusto que cobre qualquer 2xx e wildcard '2XX'
  const resContent = getSuccessResponseSchema(raw?.responses ?? {});

  // query params
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

function pascal(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getAliases(op: any) {
  const name = operationIdToMethodName(op.operationId);
  const P    = pascal(name);
  return {
    methodName:    name,
    aliasResponse: `${P}Response`,
    aliasBody:     op.hasBody        ? `${P}Body`  : null,
    aliasParams:   op.hasQueryParams ? `${P}Params` : null,
  };
}

// ─── Types file renderer ──────────────────────────────────────────────────────

function tsBlock(name: string, tsStr: string) {
  if (tsStr.trimStart().startsWith('{')) return `export interface ${name} ${tsStr}`;
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

  const lines = ['// Auto-generated by kubb-plugin-nextjs-routes — do not edit manually'];

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

    if (aliasBody && reqSchema) {
      const bodyTs = schemaToTs(reqSchema, spec);
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

function renderServiceFile({ varName, operations, apiClientPath }: any) {
  const typeNames: string[] = [];
  for (const op of operations) {
    const { aliasResponse, aliasBody, aliasParams } = getAliases(op);
    typeNames.push(aliasResponse);
    if (aliasBody)   typeNames.push(aliasBody);
    if (aliasParams) typeNames.push(aliasParams);
  }

  const methods = operations.map((op: any) => renderMethod(op)).join('\n\n');

  return `// Auto-generated by kubb-plugin-nextjs-routes — do not edit manually
import apiClient from '${apiClientPath}';
import type { ${typeNames.join(', ')} } from './types';

const ${varName} = {
${methods}
};

export default ${varName};
`;
}

function renderMethod(op: any) {
  const { methodName, aliasResponse, aliasBody, aliasParams } = getAliases(op);
  const { method, path, pathParams, hasBody, summary } = op;
  const { querySchema } = getSchemasForOp(op);
  const realHasQuery = !!querySchema;

  const nextPath = toNextPath(path);
  const urlExpr  = pathParams.reduce(
    (u: string, p: string) => u.replace(`[${p}]`, `\${${p}}`),
    nextPath,
  );
  const urlStr = pathParams.length > 0 ? `\`/api${urlExpr}\`` : `'/api${urlExpr}'`;

  const args: string[] = [];
  pathParams.forEach((p: string) => args.push(`${p}: string`));
  if (aliasBody)                   args.push(`body: ${aliasBody}`);
  if (aliasParams && realHasQuery) args.push(`params: ${aliasParams} = {} as ${aliasParams}`);

  const callArgs = [urlStr];
  if (hasBody && method === 'DELETE') callArgs.push('{ data: body }'); // axios DELETE usa { data }
  else if (hasBody)                   callArgs.push('body');
  if (realHasQuery && !hasBody)       callArgs.push('{ params }');

  const comment = summary ? `  /** ${summary} */\n` : '';

  return `${comment}  async ${methodName}(${args.join(', ')}): Promise<${aliasResponse}> {
    const { data } = await apiClient.${method.toLowerCase()}(${callArgs.join(', ')});
    return data;
  },`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function generateServices({
  spec,
  stripPathPrefix,
  servicesOut,
  apiClientPath,
  cwd,
}: any) {
  const parsed     = typeof spec === 'string' ? await fetchSpec(spec) : spec;
  const operations = extractOperations(parsed, { stripPathPrefix });

  const byTag = new Map<string, any[]>();
  for (const op of operations) {
    const tag = op.tags[0] ?? 'default';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(op);
  }

  const files: string[] = [];

  for (const [tag, ops] of byTag) {
    const slug    = slugifyTag(tag);
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

    const indexFile = join(servicesOut, slug, 'index.ts');
    writeFileSync(
      join(cwd, indexFile),
      renderServiceFile({ varName, operations: ops, apiClientPath }),
      'utf-8',
    );
    files.push(indexFile);
  }

  return files;
}
