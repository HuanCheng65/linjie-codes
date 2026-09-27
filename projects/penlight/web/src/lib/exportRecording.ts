import type { Recording } from '@linjie/penlight-core';

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 导出一局的录制数据。手机上优先调起系统分享（可以直接发到 QQ / 微信），
 * 不支持分享文件时退回到下载。
 */
export async function exportRecording(rec: Recording, tags: string[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const data = JSON.stringify({ ...rec, tags });
  const name = `penlight-${stamp(new Date(rec.createdAt))}${tags.length ? '-' + tags.join('-') : ''}.json`;

  for (const type of ['application/json', 'text/plain']) {
    const file = new File([data], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: '应援棒录制数据' });
        return 'shared';
      } catch (error) {
        if ((error as Error).name === 'AbortError') return 'cancelled';
      }
      break;
    }
  }

  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
