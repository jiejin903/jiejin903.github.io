#!/usr/bin/env node
/**
 * RSS 抓取脚本 —— 由 GitHub Actions 每日 07:00（UTC 23:00）触发
 *
 * 行为：
 *   1. 读取源清单（优先 Supabase rss_sources 表，失败则回退到同目录 sources.json）
 *   2. 并发抓取，每个源独立 try/catch，单源失败不影响其他源
 *   3. 按 link 去重（本轮内 + 数据库唯一约束）
 *   4. 批量 upsert 到 news_items（on conflict link do nothing）
 *   5. 写一条 rss_runs 运行记录；同时输出 data/news.json 作为兜底快照
 *
 * 环境变量：SUPABASE_URL / SUPABASE_KEY（GitHub Secrets，缺失时只写本地 news.json）
 *
 * 注意：必须携带浏览器 User-Agent，部分源（如 PsyPost）对空 UA 返回 403。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const hasDb = !!(SUPABASE_URL && SUPABASE_KEY);

/* ---------------- 工具 ---------------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function stripTags(s) {
  return decode(String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function pick(xml, tags) {
  for (const t of tags) {
    const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
    if (m) return decode(m[1]).trim();
  }
  return '';
}
function pickLink(item) {
  const alt = item.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return decode(alt[1]);
  const anyHref = item.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (anyHref) return decode(anyHref[1]);
  const text = item.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (text) return decode(text[1]).trim();
  const id = item.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
  if (id && /^https?:/.test(decode(id[1]).trim())) return decode(id[1]).trim();
  return '';
}
function parseDate(...cands) {
  for (const c of cands) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}
function parseFeed(xml, srcName, category, limit) {
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);
  const out = [];
  for (const b of blocks) {
    const title = stripTags(pick(b, ['title']));
    const link = pickLink(b);
    if (!title || !link) continue;
    const summary = stripTags(pick(b, ['description', 'summary', 'content:encoded', 'content']));
    out.push({
      title: title.slice(0, 300),
      link: link.slice(0, 1000),
      source: srcName,
      category,
      summary: summary.slice(0, 400),
      pub_date: parseDate(
        pick(b, ['pubDate', 'published', 'updated', 'dc:date', 'date']),
        pick(b, ['lastBuildDate'])
      ),
      is_read: false,
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}
async function fetchOnce(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(src.url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, src.name, src.category, src.limit || 0);
    if (!items.length) throw new Error('解析到 0 条');
    return items;
  } finally {
    clearTimeout(timer);
  }
}
// 单个源失败自动重试一次（瞬时网络抖动很常见），仍失败才计入 failed
async function fetchFeed(src) {
  try {
    return { src, items: await fetchOnce(src), ok: true };
  } catch (e1) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      return { src, items: await fetchOnce(src), ok: true };
    } catch (e2) {
      throw new Error(e2.message || e1.message);
    }
  }
}
async function db(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

/* ---------------- 主流程 ---------------- */
async function loadSources() {
  if (hasDb) {
    try {
      const rows = await db('rss_sources?select=*&is_active=eq.true');
      if (rows && rows.length) {
        console.log(`源清单来自数据库：${rows.length} 个`);
        return rows.map((r) => ({ name: r.name, url: r.url, category: r.category, limit: r.limit_n || 0 }));
      }
    } catch (e) {
      console.log(`读取数据库源清单失败，回退本地文件：${e.message}`);
    }
  }
  const local = JSON.parse(readFileSync(join(__dirname, 'sources.json'), 'utf8'));
  return local.sources;
}

async function main() {
  const sources = await loadSources();
  console.log(`开始抓取 ${sources.length} 个源 …`);

  const settled = await Promise.allSettled(sources.map(fetchFeed));
  const okList = [], failList = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      okList.push(r.value);
      console.log(`  [OK]   ${r.value.src.name.padEnd(24)} ${r.value.items.length} 条`);
    } else {
      failList.push({ name: sources[i].name, reason: r.reason?.message || '未知错误' });
      console.log(`  [FAIL] ${sources[i].name.padEnd(24)} ${r.reason?.message || ''}`);
    }
  });

  // 按 link 去重
  const seen = new Set(), items = [];
  for (const g of okList) {
    for (const it of g.items) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      items.push(it);
    }
  }
  console.log(`去重后共 ${items.length} 条待写入`);

  // 本地兜底快照（无论有没有数据库都写，方便页面无数据库时也能看到）
  try {
    mkdirSync(join(ROOT, 'data'), { recursive: true });
    writeFileSync(
      join(ROOT, 'data', 'news.json'),
      JSON.stringify({ updated_at: new Date().toISOString(), ok: okList.length, fail: failList.length, items }, null, 1)
    );
  } catch (e) {
    console.log('写本地快照失败：' + e.message);
  }

  // 写入 Supabase
  let inserted = 0;
  if (hasDb) {
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      try {
        await db('news_items?on_conflict=link', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(batch),
        });
        inserted += batch.length;
      } catch (e) {
        console.log(`批次 ${i / 50 + 1} 写入失败：${e.message}`);
        // 退化为逐条写入，避免整批丢失
        for (const one of batch) {
          try {
            await db('news_items?on_conflict=link', {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify([one]),
            });
            inserted++;
          } catch (e2) {
            /* 重复或脏数据，跳过 */
          }
        }
      }
    }
    try {
      await db('rss_runs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([
          {
            run_at: new Date().toISOString(),
            ok_count: okList.length,
            fail_count: failList.length,
            inserted,
            failed_sources: failList.map((f) => `${f.name}: ${f.reason}`),
          },
        ]),
      });
    } catch (e) {
      console.log('写运行记录失败（表可能未建）：' + e.message);
    }
  } else {
    console.log('未配置 SUPABASE_URL / SUPABASE_KEY，只写本地 data/news.json');
  }

  console.log(
    `\n完成：成功源 ${okList.length} / 失败源 ${failList.length}，写入 ${inserted} 条` +
      (failList.length ? `\n失败源：${failList.map((f) => f.name).join('、')}` : '')
  );
}

main().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
