// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * /admin/users/{id} → /admin/users/[id]
 */
export function toNextPath(openApiPath: string) {
  return openApiPath.replace(/\{(\w+)\}/g, '[$1]');
}

/**
 * /admin/users/{id} → ['id']
 */
export function getPathParams(openApiPath: string) {
  return [...openApiPath.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// ─── Tag / slug helpers ───────────────────────────────────────────────────────

/**
 * Normaliza uma tag para slug kebab-case limpo (sem emojis, sem chars especiais).
 * "⚙️Dev — EmailTests"  → "dev-email-tests"
 */
export function slugifyTag(tag: string) {
  return (
    tag
      .replace(/[\p{Emoji_Presentation}\p{Emoji}\uFE0F]/gu, '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  );
}

export function slugToCamel(slug: string) {
  return slug
    .split('-')
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

export function tagToVarName(tag: string) {
  return slugToCamel(slugifyTag(tag)) + 'Service';
}

// ─── OperationId helpers ──────────────────────────────────────────────────────

/**
 * adminControllerListUsers → listUsers
 * AuthController_login     → login
 */
export function operationIdToMethodName(operationId: string) {
  const withoutController = operationId.replace(/^.+Controller_?/, '');
  if (!withoutController) return operationId;
  const clean = withoutController.replace(/^_+/, '');
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

// ─── Spec fetch ───────────────────────────────────────────────────────────────

export async function fetchSpec(pathOrUrl: string) {
  if (pathOrUrl.startsWith('http')) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) throw new Error(`Falha ao buscar spec: ${pathOrUrl} (${res.status})`);
    return res.json();
  }
  const { readFileSync } = await import('fs');
  return JSON.parse(readFileSync(pathOrUrl, 'utf-8'));
}

// ─── Safe schema helpers ──────────────────────────────────────────────────────

/**
 * Resolve um $ref local com limite de profundidade para evitar ciclos.
 */
export function resolveRef(ref: string, spec: any, depth = 0): any {
  if (depth > 10) return null; // guard anti-loop
  const parts = ref.replace(/^#\//, '').split('/');
  let obj = spec;
  for (const p of parts) obj = obj?.[decodeURIComponent(p)];
  if (!obj) return null;
  // Se o resultado resolvido é ele mesmo um $ref, resolve recursivamente
  if (obj.$ref) return resolveRef(obj.$ref, spec, depth + 1);
  return obj;
}

/**
 * Extrai o nome de tipo de um $ref.
 * "#/components/schemas/LoginDto" → "LoginDto"
 */
export function refName(ref: string): string {
  return ref.split('/').pop() ?? 'unknown';
}

/**
 * Detecta se um schema OpenAPI 3.1 declara nullable via array de tipos.
 * { type: ['string', 'null'] } → true
 */
export function isNullable(schema: any): boolean {
  if (schema.nullable) return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  return false;
}

/**
 * Extrai o tipo primário de um campo 3.1 multi-type.
 * { type: ['string', 'null'] } → 'string'
 */
export function primaryType(schema: any): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t: string) => t !== 'null');
  }
  return schema.type;
}

// ─── Operation extraction ─────────────────────────────────────────────────────

/**
 * Retorna todas as operações do spec no formato normalizado.
 *
 * Melhorias vs versão original:
 * - Herda `parameters` definidos no path-level (parâmetros compartilhados)
 * - Deduplica operationIds colisionados (acrescenta sufixo numérico)
 * - Ignora paths e métodos sem operationId silenciosamente
 */
/**
 * Retorna o primeiro content-type definido no requestBody de uma operação.
 * Ex: 'application/json' | 'multipart/form-data' | undefined
 */
export function getBodyContentType(operation: any): string | undefined {
  const content = operation?.requestBody?.content ?? {};
  return Object.keys(content)[0];
}

/**
 * Busca o schema de resposta de sucesso (qualquer 2xx ou wildcard '2XX').
 * Mais robusto que checar apenas 200/201/202/204.
 */
export function getSuccessResponseSchema(responses: Record<string, any>): any {
  // Tenta por código exato na faixa 2xx
  for (const [code, response] of Object.entries(responses)) {
    const numCode = parseInt(code, 10);
    const is2xx = (!isNaN(numCode) && numCode >= 200 && numCode < 300)
      || code.toUpperCase() === '2XX'
      || code === 'default';
    if (is2xx) {
      const schema =
        response?.content?.['application/json']?.schema ??
        response?.content?.['*/*']?.schema;
      if (schema) return schema;
    }
  }
  return null;
}

export function extractOperations(spec: any, { stripPathPrefix = '' } = {}) {
  const ops: any[] = [];
  const seenIds = new Map<string, number>();

  for (const [rawPath, pathItem] of Object.entries((spec.paths ?? {}) as Record<string, any>)) {
    let path = rawPath;

    if (stripPathPrefix && path.startsWith(stripPathPrefix)) {
      path = path.slice(stripPathPrefix.length) || '/';
    }

    // Ignora o path raiz '/' — evitaria interceptar todas as rotas
    if (path === '/') continue;

    // Parâmetros definidos no nível do path (compartilhados por todos os métodos)
    const pathLevelParams: any[] = pathItem.parameters ?? [];

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      if (typeof operation !== 'object' || !operation) continue;
      if (!(operation as any).operationId) continue;

      const op = operation as any;

      // Merge params: path-level + operation-level (operation vence em conflito de nome)
      const opParamNames = new Set((op.parameters ?? []).map((p: any) => p.name));
      const mergedParams = [
        ...pathLevelParams.filter((p: any) => !opParamNames.has(p.name)),
        ...(op.parameters ?? []),
      ];

      // Deduplica operationId
      let opId: string = op.operationId;
      if (seenIds.has(opId)) {
        const count = seenIds.get(opId)! + 1;
        seenIds.set(opId, count);
        opId = `${opId}_${count}`;
      } else {
        seenIds.set(opId, 1);
      }

      const pathParams = getPathParams(path);
      const hasQueryParams = mergedParams.some((p: any) => p.in === 'query');
      const hasBody = !!op.requestBody;
      const bodyContentType = getBodyContentType(op);
      const tags = op.tags ?? ['default'];

      ops.push({
        operationId: opId,
        method: method.toUpperCase(),
        path,
        pathParams,
        hasBody,
        hasQueryParams,
        bodyContentType,   // 'application/json' | 'multipart/form-data' | undefined
        tags,
        summary: op.summary ?? '',
        _raw: { ...op, parameters: mergedParams }, // expõe params mergeados
      });
    }
  }

  return ops;
}
