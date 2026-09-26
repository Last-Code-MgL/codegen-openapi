import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildPathTree,
  buildParamMap,
  groupByTag,
  assignOperationNames,
  jsDoc,
  relativeImport,
  slugToCamel,
  type OperationNames,
  slugifyTag,
  extractOperations,
  fetchSpec,
  type PathTreeNode,
} from './utils.js';

// ─── Aliases (shared with generateServices.ts via assignOperationNames) ───────

function getAliases(op: any): OperationNames {
  return op.names;
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

  const queryKeyItems = ['tag', `'${methodName}'`, ...canonicalParams];
  if (aliasParams && hasQueryParams) queryKeyItems.push('params');
  const queryKey = `[${queryKeyItems.join(', ')}]`;

  const serviceArgs = [...canonicalParams];
  if (aliasParams && hasQueryParams) serviceArgs.push('params');

  const enabled = canonicalParams.length > 0
    ? `\n    enabled: ${canonicalParams.map((p) => `!!${p}`).join(' && ')},`
    : '';

  const comment = summary ? jsDoc(summary) : '';

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

  const comment = summary ? jsDoc(summary) : '';

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
  const hasParams = !!(aliasParams && hasQueryParams);
  // params is an object: depend on its serialized value so a new-but-equal object doesn't refetch in a loop
  const depItems  = [...canonicalParams, ...(hasParams ? ['paramsKey'] : [])];
  const deps      = `[${depItems.join(', ')}]`;
  const paramsKeyLine = hasParams ? `\n  const paramsKey = JSON.stringify(params ?? null);` : '';
  const guard     = hasDeps ? `\n    if (${canonicalParams.map(p => `!${p}`).join(' || ')}) { setLoading(false); return; }` : '';
  const initState = hasDeps ? `!!${canonicalParams.map(p => p).join(' && ')}` : 'true';

  const comment = summary ? jsDoc(summary) : '';

  return `${comment}export function ${hookName}(${args.join(', ')}) {
  const [data, setData] = useState<${aliasResponse} | null>(null);
  const [loading, setLoading] = useState(${initState});
  const [error, setError] = useState<Error | null>(null);${paramsKeyLine}

  useEffect(() => {${guard}
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  const comment = summary ? jsDoc(summary) : '';

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

function renderHooksFile({ slug, operations, serviceImport, hooksMode, tree }: any) {
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
import ${serviceVarName} from '${serviceImport}';
import type { ${typeImports.join(', ')} } from '${serviceImport}/types';
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

  const files: string[] = [];

  for (const [tag, tagOps] of groupByTag(operations)) {
    // Same naming as generateServices so hooks call the exact service methods/types
    const names = assignOperationNames(tagOps, parsed);
    const ops = tagOps.map((op: any, i: number) => ({ ...op, names: names[i] }));

    const slug = slugifyTag(tag);
    mkdirSync(join(cwd, hooksOut, slug), { recursive: true });

    const serviceImport = relativeImport(join(hooksOut, slug), join(servicesOut, slug));
    const hooksFile = join(hooksOut, slug, 'index.ts');
    writeFileSync(
      join(cwd, hooksFile),
      renderHooksFile({ slug, operations: ops, serviceImport, hooksMode, tree }),
      'utf-8',
    );
    files.push(hooksFile);
  }

  return files;
}
