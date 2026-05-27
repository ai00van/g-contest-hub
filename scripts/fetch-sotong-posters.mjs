#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const output = process.argv[2] || 'data/opportunities.json';
const base = 'https://sotong.go.kr';
const listUrl = `${base}/front/epilogue/epilogueBbsList.do`;
const manualUrlFile = 'data/sotong-urls.txt';
const pageCount = Number(process.env.SOTONG_PAGES || 5);
const pageSize = Number(process.env.SOTONG_PAGE_SIZE || 20);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeHtml(value = '') {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&middot;/g, '·')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function getMeta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, 'i');
  return decodeHtml(html.match(re)?.[1] || '').replaceAll('&amp;', '&');
}

function stripSiteTitle(title) {
  return decodeHtml(title).replace(/^소통24 \| 공모전 공고 \| 공모전 공고 상세보기 \|\s*/, '').trim();
}

function idFromUrl(url, title) {
  const id = url.match(/bbs_id=([^&]+)/)?.[1] || title;
  return `sotong-${id}`.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}

function parsePeriod(period = '') {
  const match = period.match(/(20\d{2})-(\d{2})-(\d{2})[^~]*~\s*(20\d{2})-(\d{2})-(\d{2})/);
  if (!match) return { start: '', deadline: '2026-12-31' };
  return { start: `${match[1]}-${match[2]}-${match[3]}`, deadline: `${match[4]}-${match[5]}-${match[6]}` };
}

function inferRegion(hostText, orgText) {
  const text = `${hostText} ${orgText}`;
  const regions = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
  return regions.find(region => text.includes(region)) || '전국';
}

function inferMaterials(title) {
  const text = title.toLowerCase();
  const materials = [];
  if (/사진|이미지|포스터|로고|디자인|그림|웹툰/.test(title)) materials.push('사진');
  if (/영상|숏폼|유튜브|콘텐츠|릴스|ai 영상/i.test(title)) materials.push('영상');
  if (/데이터|창업|아이디어|정책|논문|수필|동화|제안|공모/.test(title)) materials.push('글');
  if (/창업|데이터|콘테스트|경진/.test(title)) materials.push('PPT');
  return materials.length ? [...new Set(materials)] : ['글'];
}

function inferEffort(materials, title) {
  if (materials.includes('영상') || /데이터|창업|논문|경진/.test(title)) return 'week';
  if (materials.includes('사진')) return 'today';
  return 'today';
}

function inferGoals(title) {
  if (/창업|사업/.test(title)) return ['상금', '창업자금', '포트폴리오'];
  if (/영상|사진|포스터|디자인|콘텐츠/.test(title)) return ['상금', '포트폴리오'];
  return ['상금', '스펙'];
}

function buildItem({ title, host, org, period, link, posterUrl, status, desc = '' }) {
  const materials = inferMaterials(title);
  const { deadline } = parsePeriod(period);
  const region = inferRegion(host, org);
  return {
    id: idFromUrl(link, title),
    type: 'contest',
    title,
    host: host || org || '소통24',
    department: org || host || '공식 공고 확인',
    hostType: region === '전국' ? 'central' : 'local',
    region,
    targetGroup: '전 국민',
    category: 'contest',
    reward: 0,
    rewardText: '공식 공고 확인',
    target: '공식 공고 확인',
    deadline,
    link,
    posterUrl,
    desc: desc || `${host || org || '소통24'} 공모전 공고입니다. 공식 공고에서 세부 요건을 확인하세요.`,
    data: '공식 공고문, 참가신청서, 제출물',
    steps: ['공식 공고 확인', '제출물 준비', '온라인 또는 이메일 접수', '결과 발표 확인'],
    difficulty: inferEffort(materials, title) === 'week' ? '중' : '하',
    effort: inferEffort(materials, title),
    materials,
    goals: inferGoals(title),
    roles: ['student', 'jobseeker', 'founder', 'merchant', 'freelancer'],
    needsBiz: false,
    beginner: inferEffort(materials, title) !== 'month',
    caution: `${status ? `${status} 공고입니다. ` : ''}모집기간, 제출양식, 저작권 조건은 공식 공고에서 최종 확인하세요.`
  };
}

async function fetchText(url, options = {}) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'user-agent': 'Mozilla/5.0 opportunity-poster-fetcher',
          referer: `${base}/front/epilogue/epilogueBbsListPage.do?menu_id=519`,
          ...(options.headers || {})
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (i === 4) throw error;
      await sleep(800 + i * 900);
    }
  }
}

async function fetchListPage(pageNo) {
  const body = new URLSearchParams({
    miv_pageNo: String(pageNo),
    miv_pageSize: String(pageSize),
    orderBy: '',
    bbs_id: '',
    searchkey: 'A',
    searchtxt: ''
  });
  return fetchText(listUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest'
    },
    body
  });
}

function parseListItems(html) {
  const blocks = html.match(/<li class="survey_box">[\s\S]*?<\/li>\s*/g) || [];
  return blocks.map(block => {
    const status = decodeHtml(block.match(/<span class="ing_box[^"]*">([\s\S]*?)<\/span>/)?.[1] || '');
    const href = block.match(/<a class="tabBlock" href="([^"]+)"/)?.[1] || '';
    const img = block.match(/<img src="([^"]+)"/)?.[1] || '';
    const period = decodeHtml(block.match(/<div class="text_box">\s*<span>([\s\S]*?)<\/span>/)?.[1] || '');
    const rawTitle = decodeHtml(block.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] || '');
    const org = decodeHtml(block.match(/<div class="bottom">[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] || '');
    const hostMatch = rawTitle.match(/^【([^】]+)】\s*(.*)$/);
    const host = hostMatch ? hostMatch[1].trim() : org;
    const title = hostMatch ? hostMatch[2].trim() : rawTitle;
    if (!href || !title) return null;
    return buildItem({ status, title, host, org, period, link: absoluteUrl(href), posterUrl: absoluteUrl(img) });
  }).filter(Boolean);
}


const hiddenSeeds = [
  'https://nibr.spectory.net/drawing26/contest?bno=58733'
];

function buildHiddenItem({ title, link, posterUrl, desc = '' }) {
  const materials = inferMaterials(title);
  return {
    id: idFromUrl(link, title),
    type: 'contest',
    title,
    host: /생물다양성|국립생물자원관/.test(title + desc) ? '국립생물자원관' : '공식 공고 확인',
    department: /생물다양성|국립생물자원관/.test(title + desc) ? '기후에너지환경부·국립생물자원관' : '공식 공고 확인',
    hostType: 'public',
    region: '전국',
    targetGroup: '전 국민',
    category: 'contest',
    reward: 0,
    rewardText: '공식 공고 확인',
    target: '공식 공고 확인',
    deadline: /생물다양성|세밀화/.test(title + desc) ? '2026-08-28' : '2026-12-31',
    link,
    posterUrl,
    desc: desc || '부처·산하기관 공식 공고에서 발견한 숨은 공모전 후보입니다.',
    data: '공식 공고문, 참가신청서, 제출물, 첨부파일',
    steps: ['공식 링크 확인', '공모요강 확인', '제출물 준비', '접수'],
    difficulty: materials.includes('영상') || materials.includes('PPT') ? '중' : '하',
    effort: inferEffort(materials, title),
    materials,
    goals: inferGoals(title),
    roles: ['student', 'jobseeker', 'founder', 'merchant', 'freelancer'],
    needsBiz: false,
    beginner: true,
    caution: '포털 미등록 가능성이 있는 공식 공고입니다. 접수처와 제출 규격을 공식 페이지에서 최종 확인하세요.',
    discovery: '부처·산하기관 공식 공고 감시'
  };
}

async function fetchHiddenSeed(url) {
  const html = await fetchText(url);
  const rawTitle = getMeta(html, 'og:title') || html.match(/<title>([^<]+)/i)?.[1] || '공식 공모전';
  const title = stripSiteTitle(rawTitle).replace(/^공모요강\s*/, '').trim();
  const desc = getMeta(html, 'og:description') || decodeHtml(html.match(/<meta name="description" content="([^"]+)/i)?.[1] || '');
  const posterUrl = absoluteUrl(getMeta(html, 'og:image'));
  return buildHiddenItem({ title, link: url, posterUrl, desc: desc.slice(0, 180) });
}

async function readManualUrls() {
  try {
    return (await readFile(manualUrlFile, 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

async function fetchDetailItem(url) {
  const html = await fetchText(url);
  const rawTitle = getMeta(html, 'og:title') || html.match(/<title>([^<]+)/i)?.[1] || '공모전 공고';
  const title = stripSiteTitle(rawTitle);
  const desc = getMeta(html, 'og:description');
  const posterUrl = absoluteUrl(getMeta(html, 'og:image'));
  return buildItem({ title, host: '소통24', org: '공식 공고 확인', period: desc, link: url, posterUrl, status: '', desc: desc.slice(0, 180) });
}

const byId = new Map();
for (let page = 1; page <= pageCount; page++) {
  const html = await fetchListPage(page);
  const items = parseListItems(html);
  for (const item of items) byId.set(item.id, item);
  console.error(`list page ${page}: ${items.length} items`);
  await sleep(600);
}

for (const url of await readManualUrls()) {
  try {
    const item = await fetchDetailItem(url);
    byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
    console.error(`manual detail: ${item.title}`);
  } catch (error) {
    console.error(`manual detail failed: ${url} (${error.message})`);
  }
  await sleep(500);
}

for (const url of hiddenSeeds) {
  try {
    const item = await fetchHiddenSeed(url);
    byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
    console.error(`hidden seed: ${item.title}`);
  } catch (error) {
    console.error(`hidden seed failed: ${url} (${error.message})`);
  }
  await sleep(500);
}

const items = [...byId.values()].sort((a, b) => a.deadline.localeCompare(b.deadline));
await writeFile(output, `${JSON.stringify(items, null, 2)}\n`);
console.error(`wrote ${items.length} items to ${output}`);
