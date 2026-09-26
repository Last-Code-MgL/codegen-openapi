import { join } from 'path';
import { extractOperations, groupByTag, slugifyTag } from './utils.js';
import { planRoutes } from './generateRoutes.js';
import { planRoutesPages } from './generateRoutesPages.js';

export { GENERATED_HEADER } from './utils.js';

export interface PlannedFiles {
  routes: string[];
  services: string[];
  hooks: string[];
}

const posix = (p: string) => p.replace(/\\/g, '/');

/**
 * Lists every file `generate` would write for one config entry, without touching the disk.
 * Paths are relative to the project root and use forward slashes.
 * Used to detect APIs that would overwrite each other, by `diff`, and by `generate --prune`.
 */
export function planOutputFiles({
  spec,
  framework = 'nextjs',
  stripPathPrefix = '/api',
  routesOut = framework === 'nextjs-pages' ? 'pages/api' : 'src/app/api',
  servicesOut = 'src/services',
  hooksOut = 'src/hooks',
  barrel = false,
}: any): PlannedFiles {
  const routes =
    framework === 'react'
      ? []
      : [...(framework === 'nextjs-pages'
          ? planRoutesPages({ spec, stripPathPrefix, routesOut })
          : planRoutes({ spec, stripPathPrefix, routesOut })).keys()].map(posix);

  const slugs = [...groupByTag(extractOperations(spec, { stripPathPrefix })).keys()].map(slugifyTag);
  const services = slugs.flatMap((slug) => [
    posix(join(servicesOut, slug, 'index.ts')),
    posix(join(servicesOut, slug, 'types.ts')),
  ]);
  if (barrel && slugs.length) services.push(posix(join(servicesOut, 'index.ts')));
  const hooks = framework === 'react' ? slugs.map((slug) => posix(join(hooksOut, slug, 'index.ts'))) : [];

  return { routes, services, hooks };
}
