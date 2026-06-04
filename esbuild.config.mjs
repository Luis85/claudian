import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'path';
import process from 'process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  promises as fsPromises,
  readFileSync,
  rmSync,
} from 'fs';
import rendererSafeUnrefHelpers from './scripts/rendererSafeUnref.js';
import patchSdkImportMetaUrlModule from './scripts/patchSdkImportMetaUrl.js';

const {
  findUnsafeTimerUnrefSites,
  patchRendererUnsafeUnrefSites,
} = rendererSafeUnrefHelpers;
const { patchSdkImportMetaUrl } = patchSdkImportMetaUrlModule;

// Load .env.local if it exists
if (existsSync('.env.local')) {
  const envContent = readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const prod = process.argv[2] === 'production';

const patchSdkImportMeta = {
  name: 'patch-sdk-import-meta',
  setup(build) {
    build.onLoad(
      {
        filter: /[\\/]node_modules[\\/](?:@openai[\\/]codex-sdk[\\/]dist[\\/]index\.js|@anthropic-ai[\\/]claude-agent-sdk[\\/]sdk\.mjs)$/,
      },
      async (args) => {
        const contents = await fsPromises.readFile(args.path, 'utf8');
        return {
          contents: patchSdkImportMetaUrl(contents),
          loader: 'js',
        };
      },
    );
  },
};

const patchRendererUnsafeUnref = {
  name: 'patch-renderer-unsafe-unref',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0 || !existsSync('main.js')) return;

      const bundlePath = path.join(process.cwd(), 'main.js');
      const originalContents = await fsPromises.readFile(bundlePath, 'utf8');
      const patchedBundle = patchRendererUnsafeUnrefSites(originalContents);

      let finalContents = patchedBundle.contents;

      const unsafeMatches = findUnsafeTimerUnrefSites(finalContents);
      if (unsafeMatches.length > 0) {
        const details = unsafeMatches
          .slice(0, 5)
          .map((match) => `line ${match.line}: ${match.snippet}`)
          .join('\n');

        throw new Error(
          `Renderer-unsafe timer .unref() calls remain in main.js:\n${details}`,
        );
      }

      // Minify AFTER patching so renderer-unsafe-unref patterns (which match
      // unminified SDK shape) still apply. Minifying the patched output is
      // safe because the patched code uses verbose `const t = setTimeout(...);
      // t.unref?.()` form that survives minify as `setTimeout(...)?.unref?.()`.
      if (prod) {
        const minified = await esbuild.transform(finalContents, {
          loader: 'js',
          minify: true,
          legalComments: 'none',
          target: 'es2018',
          format: 'cjs',
        });
        finalContents = minified.code;
      }

      if (finalContents !== originalContents) {
        await fsPromises.writeFile(bundlePath, finalContents, 'utf8');
      }
    });
  },
};

// Obsidian plugin folder path (set via OBSIDIAN_VAULT env var or .env.local).
// The folder name MUST equal the manifest id, or Obsidian won't load the build
// (and a stale folder carrying the same id triggers a duplicate-plugin conflict).
const PLUGIN_ID = JSON.parse(readFileSync('manifest.json', 'utf-8')).id;
const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT;
const OBSIDIAN_PLUGIN_PATH = OBSIDIAN_VAULT && existsSync(OBSIDIAN_VAULT)
  ? path.join(OBSIDIAN_VAULT, '.obsidian', 'plugins', PLUGIN_ID)
  : null;

// Plugin to copy built files to Obsidian plugin folder
const copyToObsidian = {
  name: 'copy-to-obsidian',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      rmSync(path.join(process.cwd(), '.codex-vendor'), { recursive: true, force: true });

      if (!OBSIDIAN_PLUGIN_PATH) return;

      if (!existsSync(OBSIDIAN_PLUGIN_PATH)) {
        mkdirSync(OBSIDIAN_PLUGIN_PATH, { recursive: true });
      }

      const files = ['main.js', 'manifest.json', 'styles.css'];
      for (const file of files) {
        if (existsSync(file)) {
          copyFileSync(file, path.join(OBSIDIAN_PLUGIN_PATH, file));
          console.log(`Copied ${file} to Obsidian plugin folder`);
        }
      }

      const pluginVendorRoot = path.join(OBSIDIAN_PLUGIN_PATH, '.codex-vendor');
      rmSync(pluginVendorRoot, { recursive: true, force: true });
    });
  }
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  plugins: [patchSdkImportMeta, patchRendererUnsafeUnref, copyToObsidian],
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
    ...builtinModules.map(m => `node:${m}`),
    'node:sqlite',
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  // Minify runs in patchRendererUnsafeUnref onEnd (after SDK patches), not here.
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
