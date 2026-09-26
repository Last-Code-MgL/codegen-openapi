import { posix } from 'path';

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

// ─── Path tree (cross-path dynamic segment conflict resolution) ───────────────

export interface PathTreeNode {
  canonicalParam?: string;
  children: Map<string, PathTreeNode>;
}

/**
 * Builds a segment tree from all OpenAPI paths so dynamic segments at the same
 * folder level always use the same canonical param name across all routes.
 * This prevents the Next.js "different slug names for the same dynamic path" error.
 * First param name encountered at a given level wins.
 */
export function buildPathTree(paths: string[]): PathTreeNode {
  const root: PathTreeNode = { children: new Map() };
  for (const path of paths) {
    const segs = path.split('/').filter(Boolean);
    let node = root;
    for (const seg of segs) {
      if (seg.startsWith('{') && seg.endsWith('}')) {
        if (!node.children.has('*')) {
          node.children.set('*', { canonicalParam: seg.slice(1, -1), children: new Map() });
        }
        node = node.children.get('*')!;
      } else {
        if (!node.children.has(seg)) node.children.set(seg, { children: new Map() });
        node = node.children.get(seg)!;
      }
    }
  }
  return root;
}

/**
 * Converts an OpenAPI path to a Next.js dynamic routing path using a pre-built
 * path tree, guaranteeing cross-path canonical param name consistency.
 */
export function toNextPathWithTree(path: string, tree: PathTreeNode): string {
  const segs = path.split('/').filter(Boolean);
  const out: string[] = [];
  let node = tree;
  for (const seg of segs) {
    if (seg.startsWith('{') && seg.endsWith('}')) {
      const dyn = node.children.get('*');
      out.push(`[${dyn?.canonicalParam ?? seg.slice(1, -1)}]`);
      node = dyn ?? { children: new Map() };
    } else {
      out.push(seg);
      node = node.children.get(seg) ?? { children: new Map() };
    }
  }
  return '/' + out.join('/');
}

/**
 * Builds a mapping of { originalSpecParamName → canonicalNextjsParamName } for
 * a single path using the global path tree. Used by route handlers and services
 * to keep param references consistent with the generated folder structure.
 */
export function buildParamMap(path: string, tree: PathTreeNode): Record<string, string> {
  const segs = path.split('/').filter(Boolean);
  const map: Record<string, string> = {};
  let node = tree;
  for (const seg of segs) {
    if (seg.startsWith('{') && seg.endsWith('}')) {
      const orig = seg.slice(1, -1);
      const dyn = node.children.get('*');
      map[orig] = dyn?.canonicalParam ?? orig;
      node = dyn ?? { children: new Map() };
    } else {
      node = node.children.get(seg) ?? { children: new Map() };
    }
  }
  return map;
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
 * Converts arbitrary text into a camelCase identifier.
 * e.g., "get-user_by id" → "getUserById", "2fa" → "_2fa"
 */
export function toCamelIdentifier(text: string) {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '_';
  const id = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

/**
 * Slices off standard NestJS/Spring controller naming conventions for cleaner method names.
 * e.g., adminControllerListUsers → listUsers
 * e.g., AuthController_login     → login
 */
export function operationIdToMethodName(operationId: string) {
  const withoutController = operationId.replace(/^.+Controller_?/, '');
  return toCamelIdentifier(withoutController || operationId);
}

/**
 * Fully-qualified method name, used when two operations in the same service
 * would otherwise share a name.
 * e.g., AdminController_list → adminList, PostsController_list → postsList
 */
export function operationIdToQualifiedName(operationId: string) {
  return toCamelIdentifier(operationId.replace(/Controller_?/, ' '));
}

/**
 * Builds an operationId for operations that don't declare one.
 * e.g., GET /users/{id}/posts → getUsersByIdPosts
 */
export function operationIdFromPath(method: string, path: string) {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith('{') ? `by ${seg.slice(1, -1)}` : seg));
  return toCamelIdentifier([method.toLowerCase(), ...parts].join(' '));
}

// ─── Code emission helpers ────────────────────────────────────────────────────

/** Makes a schema name safe to use as a TypeScript identifier. e.g., "Page«User»" → "Page_User_" */
export function safeTypeName(name: string) {
  const id = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(id) ? `_${id}` : id || '_';
}

/** Quotes an object key when it is not a valid identifier. e.g., content-type → "content-type" */
export function propertyKey(key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/** Renders a value as a single-quoted TypeScript string literal. */
export function stringLiteral(value: string) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
}

/** Collapses text into a single line that is safe inside a `//` comment. */
export function lineComment(text: string) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/** Renders text as a JSDoc block that cannot be closed early by a `*\/` inside the text. */
export function jsDoc(text: string, indent = '') {
  const lines = String(text).replace(/\*\//g, '*\\/').trim().split(/\r?\n/).map((l) => l.trimEnd());
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join('\n')}\n${indent} */\n`;
}

/** Groups operations by their first tag (one service / hooks file per tag). */
export function groupByTag<T extends { tags: string[] }>(operations: T[]) {
  const byTag = new Map<string, T[]>();
  for (const op of operations) {
    const tag = op.tags[0] ?? 'default';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(op);
  }
  return byTag;
}

export interface OperationNames {
  methodName: string;
  hookName: string;
  aliasResponse: string;
  aliasBody: string | null;
  aliasParams: string | null;
}

/**
 * Assigns collision-free method and type names to the operations of one service file.
 * - Operations whose short names collide (e.g. two `list`) get qualified names (`usersList`, `adminList`).
 * - Operation type aliases never shadow a component schema (e.g. schema `LoginResponse` vs op `login`).
 */
export function assignOperationNames(operations: any[], spec: any): OperationNames[] {
  const shortNames = operations.map((op) => operationIdToMethodName(op.operationId));
  const counts = new Map<string, number>();
  for (const n of shortNames) counts.set(n, (counts.get(n) ?? 0) + 1);

  const usedMethods = new Set<string>();
  const usedTypes = new Set(Object.keys(spec?.components?.schemas ?? {}).map(safeTypeName));

  const unique = (candidates: string[], used: Set<string>) => {
    let name = candidates.find((c) => !used.has(c));
    for (let i = 2; !name; i++) if (!used.has(`${candidates[0]}${i}`)) name = `${candidates[0]}${i}`;
    used.add(name);
    return name;
  };

  return operations.map((op, i) => {
    const preferred = counts.get(shortNames[i])! > 1
      ? operationIdToQualifiedName(op.operationId)
      : shortNames[i];
    const methodName = unique([preferred], usedMethods);
    const P = methodName.charAt(0).toUpperCase() + methodName.slice(1);
    return {
      methodName,
      hookName: `use${P}`,
      aliasResponse: unique([`${P}Response`, `${P}ResponseData`], usedTypes),
      aliasBody: op.hasBody ? unique([`${P}Body`, `${P}Payload`], usedTypes) : null,
      aliasParams: op.hasQueryParams ? unique([`${P}Params`, `${P}QueryParams`], usedTypes) : null,
    };
  });
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
  for (const p of parts) obj = obj?.[decodePointerSegment(p)];
  if (!obj) return null;
  // Deep-resolve nested $refs
  if (obj.$ref) return resolveRef(obj.$ref, spec, depth + 1);
  return obj;
}

/** Decodes one JSON Pointer segment (URL-encoding plus the ~1 / ~0 escapes). */
function decodePointerSegment(seg: string) {
  return decodeURIComponent(seg).replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Returns the object a `$ref` points to, or the object itself when it isn't a reference. */
export function deref(obj: any, spec: any): any {
  return obj?.$ref ? resolveRef(obj.$ref, spec) ?? {} : obj;
}

/**
 * Extracts the component name from a schema $ref as a valid TypeScript identifier.
 * e.g., "#/components/schemas/LoginDto" → "LoginDto"
 * e.g., "#/components/schemas/Page«User»" → "Page_User_"
 */
export function refName(ref: string): string {
  const last = ref.split('/').pop();
  return last ? safeTypeName(decodePointerSegment(last)) : 'unknown';
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

    // Strip only on a segment boundary: "/api" strips "/api/users" but not "/apikeys"
    const prefix = stripPathPrefix.replace(/\/+$/, '');
    if (prefix && (path === prefix || path.startsWith(prefix + '/'))) {
      path = path.slice(prefix.length) || '/';
    }

    // Skips standard root endpoints to avoid hijacking the core app layer silently
    if (path === '/') continue;

    const pathLevelParams: any[] = (pathItem.parameters ?? []).map((p: any) => deref(p, spec));

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      if (typeof operation !== 'object' || !operation) continue;

      // Resolve $refs to #/components/{parameters,requestBodies,responses}
      const op = operation as any;
      const opParams: any[] = (op.parameters ?? []).map((p: any) => deref(p, spec));
      const requestBody = op.requestBody ? deref(op.requestBody, spec) : undefined;
      const responses = Object.fromEntries(
        Object.entries(op.responses ?? {}).map(([code, r]) => [code, deref(r, spec)]),
      );

      // Unify parameters tracking overlaps gracefully
      const opParamNames = new Set(opParams.map((p: any) => p.name));
      const mergedParams = [
        ...pathLevelParams.filter((p: any) => !opParamNames.has(p.name)),
        ...opParams,
      ];

      // Automatically suffix identical duplicate operational ids found on complex APIs
      let opId: string = op.operationId || operationIdFromPath(method, path);
      if (seenIds.has(opId)) {
        const count = seenIds.get(opId)! + 1;
        seenIds.set(opId, count);
        opId = `${opId}_${count}`;
      } else {
        seenIds.set(opId, 1);
      }

      const pathParams = getPathParams(path);
      const hasQueryParams = mergedParams.some((p: any) => p.in === 'query');
      const hasBody = !!requestBody;
      const bodyContentType = getBodyContentType({ requestBody });
      const tags = op.tags?.length ? op.tags : ['default'];

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
        _raw: { ...op, parameters: mergedParams, requestBody, responses },
      });
    }
  }

  return ops;
}

// ─── Import paths ─────────────────────────────────────────────────────────────

/**
 * Builds a relative module specifier from a directory to a file (both relative to cwd).
 * e.g., ('src/hooks/users', 'src/services/users') → '../../services/users'
 * e.g., ('src/app/api/users', 'src/lib/fetchBackend.ts') → '../../../lib/fetchBackend'
 */
export function relativeImport(fromDir: string, toFile: string) {
  const rel = posix.relative(toPosix(fromDir), toPosix(toFile).replace(/\.(ts|tsx|js|mjs)$/, ''));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function toPosix(p: string) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
