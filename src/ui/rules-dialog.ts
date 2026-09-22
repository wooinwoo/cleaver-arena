/** Centered rules dialog shared by every game: big readable steps plus a YouTube rule video. */
import { gameArt } from './game-art.ts';

/** Verified 2026-09-23 via YouTube oEmbed (title · channel). Gomoku video explains renju; our table plays free rule. */
export const RULE_VIDEOS: Record<string, { id: string; title: string; by: string; note?: string }> = {
  quoridor: { id: 'Cb4TJ3VB51Y', title: '쿼리도 보드게임 하는 방법 쉬운 설명', by: '용진한판' },
  gomoku: { id: 'ICSMgd63G7A', title: '오목규칙의 간단한 이해', by: 'happyrenju', note: '영상은 렌주룰 기준이에요. 여기서는 금수 없는 자유룰로 둡니다.' },
  poker: { id: 'akZVuz35Isc', title: '2분 안에 설명하는 인디언 포커', by: '합HOP 보드게임 설명' },
  janggi: { id: 'hnv_JQZmVWE', title: '동물장기 · 십이장기 룰 설명', by: '윙보드게임' },
  chess: { id: 'MnOOFtDuR0E', title: '체스 두는 법 · 10분이면 충분합니다', by: 'chessinside' },
  splendor: { id: 'uHGyzjH9CkQ', title: '스플렌더 보드게임 하는 방법 쉬운 설명', by: '용진한판' },
  davinci: { id: '7MNafu_rL_I', title: '다빈치코드 보드게임 하는 방법 쉬운 설명', by: '용진한판' },
  coup: { id: 'TPugOoh9v84', title: '쿠(Coup) 보드게임 하는 방법 쉬운 설명', by: '용진한판' },
};

let dialog: HTMLDialogElement | null = null;
const escape = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function mount() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'rules-dialog';
  dialog.setAttribute('aria-labelledby', 'rules-title');
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog!.close(); });
  dialog.addEventListener('close', () => document.documentElement.classList.remove('rules-open'));
  document.body.append(dialog);
  return dialog;
}

/** Splits the catalog's one-paragraph rules into readable steps. */
export function ruleSteps(text: string) {
  return text.split(/(?<=[.!?])\s+(?=\S)/).map(s => s.trim()).filter(Boolean);
}

export function openRules(kind: string, title: string, text: string, subtitle?: string) {
  const el = mount();
  const video = RULE_VIDEOS[kind];
  el.innerHTML = `
    <div class="rules-head">
      <div class="rules-art" aria-hidden="true">${gameArt(kind, true)}</div>
      <div class="rules-heading"><p class="rules-eyebrow">이 게임의 규칙</p><h2 id="rules-title">${escape(title)}</h2>${subtitle ? `<p class="rules-subtitle">${escape(subtitle)}</p>` : ''}</div>
      <button type="button" class="rules-close" aria-label="규칙 닫기">✕</button>
    </div>
    <ol class="rules-list">${ruleSteps(text).map(step => `<li>${escape(step)}</li>`).join('')}</ol>
    ${video ? `<a class="rules-video" href="https://www.youtube.com/watch?v=${video.id}" target="_blank" rel="noopener noreferrer">
      <span class="rules-thumb"><img src="https://i.ytimg.com/vi/${video.id}/hqdefault.jpg" alt="" loading="lazy" decoding="async" /><i aria-hidden="true">▶</i></span>
      <span class="rules-video-copy"><b>유튜브로 룰 영상 보기</b><small>${escape(video.title)} · ${escape(video.by)}</small>${video.note ? `<em>${escape(video.note)}</em>` : ''}</span>
    </a>` : ''}
    <button type="button" class="primary rules-ok">알겠어요</button>`;
  const thumb = el.querySelector<HTMLImageElement>('.rules-thumb img');
  if (thumb) thumb.onerror = () => thumb.remove();
  el.querySelector<HTMLButtonElement>('.rules-close')!.onclick = () => el.close();
  el.querySelector<HTMLButtonElement>('.rules-ok')!.onclick = () => el.close();
  document.documentElement.classList.add('rules-open');
  el.showModal();
  el.scrollTop = 0;
}
