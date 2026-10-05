import { copyFile, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import manifest from '../package.json';

const projectRoot = process.cwd();

async function createCleanInstallFixture() {
  const root = await mkdtemp(join(tmpdir(), 'bwg-component-styles-'));
  await mkdir(join(root, 'src/app'), { recursive: true });
  await copyFile(join(projectRoot, 'src/app/globals.css'), join(root, 'src/app/globals.css'));
  await copyFile(join(projectRoot, 'tailwind.config.cjs'), join(root, 'tailwind.config.cjs'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  await Promise.all(Object.keys(dependencies).map(async (name) => {
    const target = join(root, 'node_modules', name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(await realpath(join(projectRoot, 'node_modules', name)), target);
  }));
  return root;
}

describe('HeroUI styles with only declared dependencies installed', () => {
  let fixtureRoot: string;
  let css: string;

  beforeAll(async () => {
    fixtureRoot = await createCleanInstallFixture();
    const server = await createServer({
      root: fixtureRoot,
      configFile: false,
      plugins: [tailwindcss()],
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      css = (await server.transformRequest('/src/app/globals.css?direct'))?.code ?? '';
    } finally {
      await server.close();
    }
  });

  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('generates the primary button background and foreground', () => {
    expect(/\.bg-primary\s*\{\s*background-color:/.test(css)).toBe(true);
    expect(/\.text-primary-foreground\s*\{\s*color:/.test(css)).toBe(true);
  });

  it('generates stable medium icon button dimensions', () => {
    expect(/\.min-w-10\s*\{\s*min-width: calc\(var\(--spacing\) \* 10\)/.test(css)).toBe(true);
    expect(/\.w-10\s*\{\s*width: calc\(var\(--spacing\) \* 10\)/.test(css)).toBe(true);
    expect(/\.h-10\s*\{\s*height: calc\(var\(--spacing\) \* 10\)/.test(css)).toBe(true);
  });

  it('generates component alignment and theme radius utilities', () => {
    expect(/\.inline-flex\s*\{\s*display: inline-flex/.test(css)).toBe(true);
    expect(/\.rounded-medium\s*\{\s*border-radius:/.test(css)).toBe(true);
  });
});
