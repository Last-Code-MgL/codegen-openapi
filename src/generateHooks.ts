import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildPathTree,
  buildParamMap,
  operationIdToMethodName,
  slugifyTag,
  extractOperations,
  fetchSpec,
  type PathTreeNode,
} from './utils.js';

// ─── Aliases (mirrors generateServices.ts pattern) ────────────────────────────

function pascal(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getAliases(op: any) {
  const name = operationIdToMethodName(op.operationId);
  const P = pascal(name);
  return {
    methodName: name,
    hookName: `use${pascal(name)}`,
    aliasResponse: `${P}Response`,
    aliasBody: op.hasBody ? `${P}Body` : null,
    aliasParams: op.hasQueryParams ? `${P}Params` : null,
  };
}

function slugToCamel(slug: string) {
  return slug
    .split('-')
    .map((w: string, i: number) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

// ─── React Query hooks ────────────────────────────────────────────────────────

function renderQueryHook(op: any, serviceVarName: string, tree: PathTreeNode) {
  const { methodName, hookName, aliasResponse, aliasParams } = getAliases(op);
  const { path, pathParams, hasQueryParams, summary } = op;

  const paramMap = buildParamMap(path, tree);
  const canonicalParams: string[] = pathParams.map((p: string) => paramMap[p] ?? p);

  const args: string[] = [];
  canonicalParams.forEach((p: string) => args.push(`${p}: string`));
  if (aliasParams && hasQueryParams) args.push(`params?: ${aliasParams}`);

  const queryKeyItems = ['tag', ...canonicalParams];
  if (aliasParams && hasQueryParams) queryKeyItems.push('params');
  const queryKey = `[${queryKeyItems.join(', ')}]`;

  const serviceArgs = [...canonicalParams];
  if (aliasParams && hasQueryParams) serviceArgs.push('params');

  const enabled = canonicalParams.length > 0
    ? `\n    enabled: ${canonicalParams.map((p) => `!!${p}`).join(' && ')},`
    : '';

  const comment = summary ? `/** ${summary} */\n` : '';

  return `${comment}export function ${hookName}(${args.join(', ')}) {
  return useQuery<${aliasResponse}>({
    queryKey: ${queryKey},
    queryFn: () => ${serviceVarName}.${methodName}(${serviceArgs.join(', ')}),${enabled}
  });
}`;
}

function renderMutationHook(op: any, serviceVarName: string, tagKey: string, tree: PathTreeNode) {
  const { methodName, hookName, aliasResponse, aliasBody } = getAliases(op);
  const { path, pathParams, hasBody, summary } = op;

  const paramMap = buildParamMap(path, tree);
  const canonicalParams: string[] = pathParams.map((p: string) => paramMap[p] ?? p);

  const varFields: string[] = [];
  canonicalParams.forEach((p: string) => varFields.push(`${p}: string`));
  if (aliasBody && hasBody) varFields.push(`body: ${aliasBody}`);

  const varsType = varFields.length > 0 ? `{ ${varFields.join('; ')} }` : 'void';

  const serviceArgs: string[] = [];
  canonicalParams.forEach((p: string) => serviceArgs.push(`vars.${p}`));
  if (aliasBody && hasBody) serviceArgs.push('vars.body');

  const mutationFn = varFields.length > 0
    ? `(vars: ${varsType}) => ${serviceVarName}.${methodName}(${serviceArgs.join(', ')})`
    : `() => ${serviceVarName}.${methodName}()`;

  const comment = summary ? `/** ${summary} */\n` : '';

  return `${comment}export function ${hookName}() {
  const queryClient = useQueryClient();
  return useMutation<${aliasResponse}, Error, ${varsType}>({
    mutationFn: ${mutationFn},
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [${tagKey}] });
    },
  });
}`;
}

// ─── Plain fetch hooks (useState + useEffect, zero dependencies) ──────────────

function renderFetchQueryHook(op: any, serviceVarName: string, tree: PathTreeNode) {
  const { methodName, hookName, aliasResponse, aliasParams } = getAliases(op);
  const { path, pathParams, hasQueryParams, summary } = op;

  const paramMap = buildParamMap(path, tree);
  const canonicalParams: string[] = pathParams.map((p: string) => paramMap[p] ?? p);

  const args: string[] = [];
  canonicalParams.forEach((p: string) => args.push(`${p}: string`));
  if (aliasParams && hasQueryParams) args.push(`params?: ${aliasParams}`);

  const serviceArgs = [...canonicalParams];
  if (aliasParams && hasQueryParams) serviceArgs.push('params');

  const hasDeps   = canonicalParams.length > 0;
  const deps      = hasDeps ? `[${canonicalParams.join(', ')}]` : '[]';
  const guard     = hasDeps ? `\n    if (${canonicalParams.map(p => `!${p}`).join(' || ')}) { setLoading(false); return; }` : '';
  const initState = hasDeps ? `!!${canonicalParams.map(p => p).join(' && ')}` : 'true';

  const comment = summary ? `/** ${summary} */\n` : '';

  return `${comment}export function ${hookName}(${args.join(', ')}) {
  const [data, setData] = useState<${aliasResponse} | null>(null);
  const [loading, setLoading] = useState(${initState});
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {${guard}
    let cancelled = false;
    setLoading(true);
    ${serviceVarName}.${methodName}(${serviceArgs.join(', ')})
      .then(res => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); } });
    return () => { cancelled = true; };
  }, ${deps});

  return { data, loading, error };
}`;
}

function renderFetchMutationHook(op: any, serviceVarName: string, tree: PathTreeNode) {
  const { methodName, hookName, aliasResponse, aliasBody } = getAliases(op);
  const { path, pathParams, hasBody, summary } = op;

  const paramMap = buildParamMap(path, tree);
  const canonicalParams: string[] = pathParams.map((p: string) => paramMap[p] ?? p);

  const varFields: string[] = [];
  canonicalParams.forEach((p: string) => varFields.push(`${p}: string`));
  if (aliasBody && hasBody) varFields.push(`body: ${aliasBody}`);

  const varsType = varFields.length > 0 ? `{ ${varFields.join('; ')} }` : 'void';

  const serviceArgs: string[] = [];
  canonicalParams.forEach((p: string) => serviceArgs.push(`vars.${p}`));
  if (aliasBody && hasBody) serviceArgs.push('vars.body');

  const mutateArg  = varFields.length > 0 ? `vars: ${varsType}` : '';
  const awaitCall  = `await ${serviceVarName}.${methodName}(${serviceArgs.join(', ')})`;

  const comment = summary ? `/** ${summary} */\n` : '';

  return `${comment}export function ${hookName}() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = async (${mutateArg}): Promise<${aliasResponse}> => {
    setLoading(true);
    setError(null);
    try {
      const result = ${awaitCall};
      return result;
    } catch (e) {
      const caught = e instanceof Error ? e : new Error(String(e));
      setError(caught);
      throw caught;
    } finally {
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}`;
}

// ─── Hooks file renderer ──────────────────────────────────────────────────────

function renderHooksFile({ slug, operations, servicesOut, hooksMode, tree }: any) {
  const serviceVarName = slugToCamel(slug) + 'Service';
  const tagKey = JSON.stringify(slug);
  const isFetch = hooksMode === 'fetch';

  const typeImports: string[] = [];
  for (const op of operations) {
    const { aliasResponse, aliasBody, aliasParams } = getAliases(op);
    typeImports.push(aliasResponse);
    if (aliasBody) typeImports.push(aliasBody);
    if (aliasParams) typeImports.push(aliasParams);
  }

  const hooks = operations
    .map((op: any) => {
      const isGet = op.method === 'GET';
      if (isFetch) {
        return isGet
          ? renderFetchQueryHook(op, serviceVarName, tree)
          : renderFetchMutationHook(op, serviceVarName, tree);
      }
      return isGet
        ? renderQueryHook(op, serviceVarName, tree)
        : renderMutationHook(op, serviceVarName, tagKey, tree);
    })
    .join('\n\n');

  const importLine = isFetch
    ? `import { useState, useEffect } from 'react';`
    : `import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';`;

  const tagConst = isFetch ? '' : `\nconst tag = ${tagKey};\n`;

  return `// Auto-generated by codegen-openapi — do not edit manually
${importLine}
import ${serviceVarName} from '${servicesOut}/${slug}';
import type { ${typeImports.join(', ')} } from '${servicesOut}/${slug}/types';
${tagConst}
${hooks}
`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function generateHooks({
  spec,
  stripPathPrefix,
  hooksOut,
  servicesOut,
  hooksMode = 'react-query',
  cwd,
}: any) {
  const parsed = typeof spec === 'string' ? await fetchSpec(spec) : spec;
  const operations = extractOperations(parsed, { stripPathPrefix });

  // Build tree once for cross-path canonical param consistency
  const tree = buildPathTree(operations.map((op: any) => op.path));

  const byTag = new Map<string, any[]>();
  for (const op of operations) {
    const tag = op.tags[0] ?? 'default';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(op);
  }

  const files: string[] = [];

  for (const [tag, ops] of byTag) {
    const slug = slugifyTag(tag);
    mkdirSync(join(cwd, hooksOut, slug), { recursive: true });

    const hooksFile = join(hooksOut, slug, 'index.ts');
    writeFileSync(
      join(cwd, hooksFile),
      renderHooksFile({ slug, operations: ops, servicesOut, hooksMode, tree }),
      'utf-8',
    );
    files.push(hooksFile);
  }

  return files;
}
