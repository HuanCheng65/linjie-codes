// 把所有要发布到 GitHub Pages 的网页汇总到 _site/。
// 在 package.json 里写了 "linjie": { "pages": "<路径>" } 的包会被收进来，
// 发布地址是 <站点>/<路径>/，需要先 pnpm build。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const sites = [];
for (const project of readdirSync(join(root, 'projects'), { withFileTypes: true })) {
  if (!project.isDirectory()) continue;
  const projectDir = join(root, 'projects', project.name);
  for (const pkg of readdirSync(projectDir, { withFileTypes: true })) {
    const manifest = join(projectDir, pkg.name, 'package.json');
    if (!pkg.isDirectory() || !existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    const path = json.linjie?.pages;
    if (!path) continue;
    const dist = join(projectDir, pkg.name, 'dist');
    if (!existsSync(dist)) throw new Error(`${json.name} 还没有构建：找不到 ${dist}`);
    cpSync(dist, join(out, path), { recursive: true });
    sites.push({ path, title: json.linjie.title ?? json.name, description: json.description ?? '' });
    console.log(`${json.name} → /${path}/`);
  }
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>临界</title>
<style>
  :root { color-scheme: dark light; --bg: #0a0a0f; --fg: #f2f2f5; --mute: rgba(242,242,245,.55); --line: rgba(255,255,255,.1); }
  @media (prefers-color-scheme: light) { :root { --bg: #f4f4f0; --fg: #131318; --mute: rgba(19,19,24,.55); --line: rgba(0,0,0,.1); } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, "PingFang SC", "Noto Sans SC", system-ui, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 48px 20px; }
  h1 { font-size: 26px; margin: 0 0 24px; }
  a { display: block; padding: 16px 0; border-top: 1px solid var(--line); color: inherit; text-decoration: none; }
  a:last-child { border-bottom: 1px solid var(--line); }
  b { display: block; font-size: 17px; }
  span { color: var(--mute); font-size: 13px; }
</style>
<main>
  <h1>临界</h1>
  ${sites.map((s) => `<a href="./${esc(s.path)}/"><b>${esc(s.title)}</b><span>${esc(s.description)}</span></a>`).join('\n  ')}
</main>
</html>
`,
);
