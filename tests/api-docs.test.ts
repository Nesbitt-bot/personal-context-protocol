import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Drift check: every route under src/app/api/v1 must be documented in
 * docs/protocol.md. Paths are compared with dynamic segments normalized
 * (`[id]`/`:sessionId` -> `:p`) and the `/api/v1` prefix stripped, so naming
 * differences don't cause false failures.
 */

const API_ROOT = join(process.cwd(), 'src', 'app', 'api', 'v1');

function collectRoutes(dir: string, base = ''): string[] {
  let routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes = routes.concat(collectRoutes(join(dir, entry.name), `${base}/${entry.name}`));
    } else if (entry.name === 'route.ts') {
      routes.push(base || '/');
    }
  }
  return routes;
}

const routePaths = collectRoutes(API_ROOT).map((p) => p.replace(/\[[^\]]+\]/g, ':p'));
const docNormalized = readFileSync(join(process.cwd(), 'docs', 'protocol.md'), 'utf8')
  .replace(/\/api\/v1/g, '')
  .replace(/:[A-Za-z_]+/g, ':p');

describe('API docs are in sync with src/app/api/v1', () => {
  it('finds route files to check', () => {
    expect(routePaths.length).toBeGreaterThan(10);
  });

  for (const route of routePaths) {
    it(`protocol.md documents ${route}`, () => {
      const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${escaped}(?![A-Za-z0-9_/])`);
      expect(pattern.test(docNormalized)).toBe(true);
    });
  }
});
