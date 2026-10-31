// Headless capture of a Native Federation page: node nf-capture.mjs <url> [--wait ms] [--profile dir] [--headed]
// Needs `playwright` or `playwright-core` resolvable from the cwd. Prints one JSON report to stdout.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'noop.js'));
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('playwright-core'); }
})();

const [url, ...args] = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const waitMs = Number(opt('--wait', 2000));
const profile = opt('--profile');
const headless = !args.includes('--headed');
const script = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');

const launch = async () => {
  // Prefer an installed Chrome: playwright-core can't download its own browser build.
  const options = { headless, channel: process.env.PW_CHANNEL ?? 'chrome' };
  if (profile) return chromium.launchPersistentContext(profile, options);
  return (await chromium.launch(options)).newContext();
};

const report = { url, console: [], pageErrors: [], failedRequests: [], scripts: [] };
const context = await launch();
const page = context.pages()[0] ?? (await context.newPage());

const pending = [];
page.on('console', (m) => {
  const entry = { type: m.type(), text: m.text(), at: m.location().url };
  report.console.push(entry);
  // text() truncates object previews; NF logs errors as `{ error: NFError }`, so expand the args of errors/warnings.
  if (entry.type === 'error' || entry.type === 'warning') {
    pending.push(Promise.all(m.args().map((a) => a.evaluate(stringify).catch(() => '?'))).then((args) => (entry.args = args)));
  }
});
page.on('pageerror', (e) => report.pageErrors.push({ message: e.message, stack: e.stack }));
page.on('requestfailed', (r) => report.failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
page.on('response', (r) => {
  if (r.status() >= 400) report.failedRequests.push({ url: r.url(), status: r.status() });
  // es-module-shims re-runs fetched sources from blob: URLs; only the original fetch URL is useful.
  if (/^https?:.*\.m?js(\?|$)/.test(r.url())) report.scripts.push(r.url());
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(waitMs);
page.removeAllListeners('console'); // the dump scripts below log their own output
await Promise.all(pending);

report.runtime = await page.evaluate(script('./detect-runtime.js'));
report.importMaps = await page.evaluate(script('./dump-import-map.js'));
report.orchestratorStorage = await page.evaluate(script('./dump-orchestrator-storage.js'));
report.classicState = await page.evaluate(script('./dump-classic-state.js'));
report.sharedLoads = attributeLoads(report.importMaps, report.scripts, await page.evaluate(() => document.baseURI));

console.log(JSON.stringify(report, null, 2));
await (context.browser() ?? context).close();

function stringify(value) {
  const errors = (_, v) => (v instanceof Error ? `${v.stack ?? v}${v.cause ? `\ncause: ${v.cause.stack ?? v.cause}` : ''}` : v);
  return typeof value === 'string' ? value : JSON.stringify(value, errors) ?? String(value);
}

// Maps every loaded script URL back to the import-map specifier(s) pointing at it (in `imports` or any scope).
// A specifier with more than one loaded URL means the browser ran more than one copy of that package.
function attributeLoads(maps, loaded, baseURI) {
  const bySpecifier = {};
  const add = ([specifier, target]) => {
    const href = new URL(target, baseURI).href;
    if (loaded.includes(href)) (bySpecifier[specifier] ??= new Set()).add(href);
  };
  for (const { map } of maps.filter((m) => m.map)) {
    Object.entries(map.imports ?? {}).forEach(add);
    Object.values(map.scopes ?? {}).forEach((entries) => Object.entries(entries).forEach(add));
  }
  const out = Object.fromEntries(Object.entries(bySpecifier).map(([s, urls]) => [s, [...urls]]));
  const duplicates = Object.keys(out).filter((s) => out[s].length > 1 && !s.startsWith('@nf-internal/'));
  return { duplicates, bySpecifier: out };
}
