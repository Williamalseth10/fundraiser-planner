// Inlines the engine, demo data and UI into one self-contained HTML file: dist/booster-fundraiser-planner.html
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const html = read('src/index.src.html')
  .replace('/*__ENGINE__*/', () => safe(read('src/engine.js')))
  .replace('/*__DEMO__*/', () => safe(read('src/demo-data.js')))
  .replace('/*__APP__*/', () => safe(read('src/app.js')));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/booster-fundraiser-planner.html'), html);
// GitHub Pages serves index.html from the repository root.
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('built dist/booster-fundraiser-planner.html', html.length, 'bytes');
// Hosted-page variant: the host supplies the doctype/html/head/body skeleton, so keep only <title>, <meta>, <style> and body content.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
// Hosted viewers can't receive file downloads, so every download button (class "dl-only") is hidden there.
// "Show plan as text" and Copy still work for keeping a backup.
const hostedHead = head.trim() + '\n<style>.dl-only { display: none !important; }</style>';
fs.writeFileSync(path.join(root, 'dist/hosted.html'), hostedHead + '\n' + body.trim() + '\n');
console.log('built dist/hosted.html');
