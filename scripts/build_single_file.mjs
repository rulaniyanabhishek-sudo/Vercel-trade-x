import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const bundlePath = '/tmp/tradex.bundle.js';
execFileSync('npx', ['esbuild', 'src/main.js', '--bundle', '--format=iife', '--target=es2020', `--outfile=${bundlePath}`], { cwd: root, stdio: 'inherit' });
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
const js = readFileSync(bundlePath, 'utf8');
const err = `
<script>
window.addEventListener('error', function(e) {
  var app = document.getElementById('app');
  if (app && app.textContent && app.textContent.indexOf('Starting app') !== -1) {
    app.innerHTML = '<div class="boot-loader"><h1>Trade X</h1><p style="color:#ffb4bc;max-width:720px;line-height:1.6">Startup error: ' + String(e.message || e.error || 'Unknown error') + '</p><p style="color:#8795aa">Please use the refreshed run.html file.</p></div>';
  }
});
window.addEventListener('unhandledrejection', function(e) {
  var app = document.getElementById('app');
  if (app && app.textContent && app.textContent.indexOf('Starting app') !== -1) {
    app.innerHTML = '<div class="boot-loader"><h1>Trade X</h1><p style="color:#ffb4bc;max-width:720px;line-height:1.6">Startup error: ' + String((e.reason && e.reason.message) || e.reason || 'Unhandled promise rejection') + '</p></div>';
  }
});
</script>`;
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Trade X — QA Verified Build</title>
  <meta name="description" content="Self-contained running build of Trade X with QA-verified delayed Indian market prices." />
  <style>${css}</style>
</head>
<body>
  <div id="app" class="app-shell-loading">
    <div class="boot-loader">
      <div class="loader-ring"></div>
      <h1>Trade X</h1>
      <p>Starting QA-verified app…</p>
    </div>
  </div>
  ${err}
  <script src="./config.js"></script>
  <script>${js}</script>
</body>
</html>`;
writeFileSync(resolve(root, 'run.html'), html);
writeFileSync(resolve(root, 'index.html'), html);
writeFileSync(resolve(root, '404.html'), html);
console.log(`Built ${resolve(root, 'run.html')} (${html.length} bytes)`);
console.log('Synced index.html and 404.html for GitHub Pages.');
