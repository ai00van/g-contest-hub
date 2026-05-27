#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2] || 'data/sotong-urls.txt';
const output = process.argv[3] || 'data/opportunities.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getMeta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, 'i');
  return (html.match(re)?.[1] || '').replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim();
}

function stripSiteTitle(title) {
  return title.replace(/^소통24 \| 공모전 공고 \| 공모전 공고 상세보기 \|\s*/, '').trim();
}

function inferDeadline(text) {
  const normalized = text.replace(/\s+/g, ' ');
  const match = normalized.match(/(?:~|부터|기간[:：]?)[^\d]*(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return '2026-12-31';
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function idFromUrl(url, title) {
  const id = url.match(/bbs_id=([^&]+)/)?.[1] || title;
  return `sotong-${id}`.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}

async function fetchHtml(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 opportunity-poster-fetcher' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (i === 3) throw error;
      await sleep(700 + i * 900);
    }
  }
}

const urls = (await readFile(input, 'utf8'))
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const items = [];
for (const url of urls) {
  const html = await fetchHtml(url);
  const rawTitle = getMeta(html, 'og:title') || html.match(/<title>([^<]+)/i)?.[1] || '공모전 공고';
  const title = stripSiteTitle(rawTitle);
  const desc = getMeta(html, 'og:description');
  const posterUrl = getMeta(html, 'og:image');
  items.push({
    id: idFromUrl(url, title),
    type: 'contest',
    title,
    host: '소통24',
    department: '공식 공고 확인',
    hostType: 'central',
    region: '전국',
    targetGroup: '전 국민',
    category: 'contest',
    reward: 0,
    rewardText: '공식 공고 확인',
    target: '공식 공고 확인',
    deadline: inferDeadline(desc),
    link: url,
    posterUrl,
    desc: desc.slice(0, 180),
    data: '공식 공고문, 참가신청서, 제출물',
    steps: ['공식 공고 확인', '제출물 준비', '온라인 또는 이메일 접수', '결과 발표 확인'],
    difficulty: '하',
    effort: 'today',
    materials: ['글'],
    goals: ['상금', '스펙', '포트폴리오'],
    roles: ['student', 'jobseeker', 'founder', 'merchant', 'freelancer'],
    needsBiz: false,
    beginner: true,
    caution: '모집기간, 제출양식, 저작권 조건은 공식 공고에서 최종 확인하세요.'
  });
  console.error(`fetched: ${title}`);
  await sleep(500);
}

await writeFile(output, `${JSON.stringify(items, null, 2)}\n`);
console.error(`wrote ${items.length} items to ${output}`);
