// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Normalizes a path parameter name for use in Next.js dynamic route segments.
 * Params ending in 'Id' (e.g. componentId, userId) become 'id' unless another
 * param in the same path would produce the same normalized name (conflict).
 */
export function normalizeParamName(param: string, allParams: string[]): string {
  if (/[Ii]d$/.test(param)) {
    const others = allParams.filter(p => p !== param);
    const othersNormalized = others.map(p => (/[Ii]d$/.test(p) ? 'id' : p));
    if (!othersNormalized.includes('id')) return 'id';
  }
  return param;
}

/**
 * Transforms an OpenAPI path to a Next.js dynamic routing path.
 * e.g., /admin/users/{userId} → /admin/users/[id]
 * e.g., /orgs/{orgId}/repos/{repoId} → /orgs/[orgId]/repos/[repoId] (conflict: both kept)
 */
export function toNextPath(openApiPath: string) {
  const params = getPathParams(openApiPath);
  return openApiPath.replace(/\{(\w+)\}/g, (_, p) => `[${normalizeParamName(p, params)}]`);
}

/**
 * Extracts path parameters from an OpenAPI path.
 * e.g., /admin/users/{id} → ['id']
 */
export function getPathParams(openApiPath: string) {
  return [...openApiPath.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// ─── Tag / slug helpers ───────────────────────────────────────────────────────

/**
 * Normalizes a tag string into a clean kebab-case slug (stripping emojis, special chars).
 * e.g., "⚙️Dev — EmailTests" → "dev-email-tests"
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
 * Slices off standard NestJS/Spring controller naming conventions for cleaner method names.
 * e.g., adminControllerListUsers → listUsers
 * e.g., AuthController_login     → login
 */
export function operationIdToMethodName(operationId: string) {
  const withoutController = operationId.replace(/^.+Controller_?/, '');
  if (!withoutController) return operationId;
  const clean = withoutController.replace(/^_+/, '');
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

// ─── Spec fetching ───────────────────────────────────────────────────────────────

export async function fetchSpec(pathOrUrl: string) {
  if (pathOrUrl.startsWith('http')) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) throw new Error(`Failed to fetch spec: ${pathOrUrl} (${res.status})`);
    return res.json();
  }
  const { readFileSync } = await import('fs');
  return JSON.parse(readFileSync(pathOrUrl, 'utf-8'));
}

// ─── Safe schema helpers ──────────────────────────────────────────────────────

/**
 * Resolves a local OpenAPI $ref with built-in depth limits to prevent cyclic crashes.
 */
export function resolveRef(ref: string, spec: any, depth = 0): any {
  if (depth > 10) return null; // Guardian against infinite loops
  const parts = ref.replace(/^#\//, '').split('/');
  let obj = spec;
  for (const p of parts) obj = obj?.[decodeURIComponent(p)];
  if (!obj) return null;
  // Deep-resolve nested $refs
  if (obj.$ref) return resolveRef(obj.$ref, spec, depth + 1);
  return obj;
}

/**
 * Extracts the raw type or component name from a schema $ref.
 * e.g., "#/components/schemas/LoginDto" → "LoginDto"
 */
export function refName(ref: string): string {
  return ref.split('/').pop() ?? 'unknown';
}

/**
 * Detects if an OpenAPI 3.1 schema utilizes an array format to declare nullability.
 * e.g., { type: ['string', 'null'] } → true
 */
export function isNullable(schema: any): boolean {
  if (schema.nullable) return true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) return true;
  return false;
}

/**
 * Extracts the primary logical typing of a 3.1 multi-type array property.
 * e.g., { type: ['string', 'null'] } → 'string'
 */
export function primaryType(schema: any): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t: string) => t !== 'null');
  }
  return schema.type;
}

// ─── Operation extraction ─────────────────────────────────────────────────────

/**
 * Grabs the initial content-type defined within an operation's requestBody.
 * e.g., 'application/json' | 'multipart/form-data' | undefined
 */
export function getBodyContentType(operation: any): string | undefined {
  const content = operation?.requestBody?.content ?? {};
  return Object.keys(content)[0];
}

/**
 * Identifies the successful underlying response schema (ranging through 2xx or literal '2XX' wildcard outputs).
 * Far more robust than hardcoding check against 200/201/204.
 */
export function getSuccessResponseSchema(responses: Record<string, any>): any {
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

/**
 * Scans the full parsed OpenAPI specification and returns normalized operations.
 *
 * It specifically solves:
 * - Inheriting variables mapped at the root route/path level parameters
 * - Deduplicating identical/overlapping operationIds internally
 * - Ignoring nested empty endpoints safely
 */
export function extractOperations(spec: any, { stripPathPrefix = '' } = {}) {
  const ops: any[] = [];
  const seenIds = new Map<string, number>();

  for (const [rawPath, pathItem] of Object.entries((spec.paths ?? {}) as Record<string, any>)) {
    let path = rawPath;

    if (stripPathPrefix && path.startsWith(stripPathPrefix)) {
      path = path.slice(stripPathPrefix.length) || '/';
    }

    // Skips standard root endpoints to avoid hijacking the core app layer silently
    if (path === '/') continue;

    const pathLevelParams: any[] = pathItem.parameters ?? [];

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      if (typeof operation !== 'object' || !operation) continue;
      if (!(operation as any).operationId) continue;

      const op = operation as any;

      // Unify parameters tracking overlaps gracefully
      const opParamNames = new Set((op.parameters ?? []).map((p: any) => p.name));
      const mergedParams = [
        ...pathLevelParams.filter((p: any) => !opParamNames.has(p.name)),
        ...(op.parameters ?? []),
      ];

      // Automatically suffix identical duplicate operational ids found on complex APIs
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
        _raw: { ...op, parameters: mergedParams },
      });
    }
  }

  return ops;
}
