/**
 * 回放录制数据：pnpm --filter @linjie/penlight-core replay <文件或目录> [--sensitivity 3] [--csv]
 *
 * 用当前的检测和判定重新跑一遍，打印和录制时的成绩对比。
 * 加 --csv 会在每个文件旁边输出一份挥动明细（歌曲时间、方向、力度、相对最近拍子的位置）。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beatPosition, replay, type Recording } from '../src/index';

const args = process.argv.slice(2);
const csv = args.includes('--csv');
const si = args.indexOf('--sensitivity');
const sensitivity = si >= 0 ? Number(args[si + 1]) : undefined;
const targets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--sensitivity');
if (targets.length === 0) targets.push(join(import.meta.dirname, '..', 'recordings'));

const files = targets.flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(p, f))
    : [p],
);

const DENSITY = { half: '半', beat: '拍', two: '二', sparse: '稀', none: '·' } as const;

for (const file of files) {
  const rec = JSON.parse(readFileSync(file, 'utf8')) as Recording;
  if (rec.format !== 'penlight-recording') continue;
  const r = replay(rec, { sensitivity });
  const was = rec.result;
  const f = (x: number) => x.toFixed(1);
  console.log(`\n${file}`);
  console.log(`  ${rec.song.title} · ${rec.inputMode} · 来源 ${r.source ?? '—'} · 灵敏度 ${sensitivity ?? rec.sensitivity} · 标签 ${rec.tags.join('、') || '—'}`);
  console.log(`  ${rec.userAgent}`);
  console.log(
    `  现在 ${f(r.result.score)} 分（同步 ${f(r.result.sync * 100)}%，参与 ${f(r.result.participation * 100)}%，命中 ${r.result.hits}，乱挥 ${r.result.strays}，中性 ${r.result.neutral}）` +
      (was ? `  录制时 ${f(was.score)} 分` : ''),
  );
  console.log(`  检测到 ${r.swings.length} 下，偏移 ${r.result.offsetMs?.toFixed(0) ?? '—'} ms，平均偏差 ${r.result.meanAbsDeviationMs?.toFixed(0) ?? '—'} ms`);
  console.log(`  每小节密度 ${r.result.timeline.map((d) => DENSITY[d]).join('')}`);

  if (csv) {
    const lines = ['song_time,dir,strength,beat_position'];
    for (const s of r.swings) lines.push(`${s.t.toFixed(4)},${s.dir},${s.strength.toFixed(1)},${beatPosition(rec.chart.grid, s.t).toFixed(3)}`);
    writeFileSync(file.replace(/\.json$/, '.swings.csv'), lines.join('\n'));
  }
}
