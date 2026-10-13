-- ============================================
-- 补充建表：RSS 源管理 + 抓取运行记录
-- 若已在 SQL Editor 执行过 supabase_schema.sql（12 张表），
-- 这里再执行一次即可，脚本幂等，重复执行无副作用。
-- 用法：Supabase → SQL Editor → New query → 整段粘贴 → Run
-- ============================================

-- ---------- RSS 源清单（页面「设置 → 新闻源管理」可增删）----------
create table if not exists rss_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  category text check (category in ('ai','psychology')),
  limit_n int default 0,        -- 每次抓取最多条数，0 表示不限
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ---------- 抓取运行记录（页面顶部「部分来源更新失败」提示来源）----------
create table if not exists rss_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz default now(),
  ok_count int default 0,
  fail_count int default 0,
  inserted int default 0,
  failed_sources text[] default '{}'
);

alter table rss_sources enable row level security;
alter table rss_runs    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rss_sources','rss_runs'] loop
    execute format('drop policy if exists p_all on %I', t);
    execute format('create policy p_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- 初始化默认 15 个源（仅表为空时写入）----------
insert into rss_sources (name, url, category, limit_n)
select v.name, v.url, v.category, v.limit_n
from (values
  ('量子位',                 'https://www.qbitai.com/feed',                                          'ai', 0),
  ('雷峰网',                 'https://www.leiphone.com/feed',                                        'ai', 0),
  ('爱范儿',                 'https://www.ifanr.com/feed',                                           'ai', 0),
  ('OpenAI Blog',            'https://openai.com/blog/rss.xml',                                      'ai', 20),
  ('Google AI Blog',         'https://blog.google/technology/ai/rss/',                               'ai', 0),
  ('TechCrunch AI',          'https://techcrunch.com/category/artificial-intelligence/feed/',        'ai', 0),
  ('MIT Technology Review',  'https://www.technologyreview.com/feed/',                               'ai', 0),
  ('Simon Willison',         'https://simonwillison.net/atom/everything/',                           'ai', 0),
  ('Hacker News',            'https://hnrss.org/frontpage',                                          'ai', 0),
  ('PsyPost',                'https://www.psypost.org/feed',                                         'psychology', 0),
  ('Science Daily 心理学',    'https://www.sciencedaily.com/rss/mind_brain/psychology.xml',           'psychology', 0),
  ('Neuroscience News',      'https://neurosciencenews.com/feed/',                                   'psychology', 0),
  ('Nature Human Behaviour', 'https://www.nature.com/nathumbehav.rss',                               'psychology', 0),
  ('Aeon',                   'https://aeon.co/feed',                                                 'psychology', 0),
  ('Nautilus',               'https://nautil.us/feed/',                                              'psychology', 0)
) as v(name, url, category, limit_n)
where not exists (select 1 from rss_sources);

-- ---------- 完成校验 ----------
select table_name from information_schema.tables
where table_schema='public' and table_name in ('rss_sources','rss_runs');
