-- ============================================
-- 个人工作台 建表脚本 v1.1
-- 用法：Supabase 左侧 SQL Editor -> New query -> 整段粘贴 -> Run
-- 幂等：重复执行不会产生重复数据
-- ============================================

-- ---------- 任务 ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  priority text default 'mid' check (priority in ('high','mid','low')),
  due_date date,
  status text default 'pending' check (status in ('pending','done')),
  done_at timestamptz,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- ---------- 习惯定义 ----------
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text default 'circle',
  color text default '#E8836B',
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ---------- 打卡记录（habit_id + date 唯一，防止同日重复打卡）----------
create table if not exists habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid references habits(id) on delete cascade,
  date date not null,
  created_at timestamptz default now(),
  unique (habit_id, date)
);

-- ---------- 灵感 ----------
create table if not exists inspirations (
  id uuid primary key default gen_random_uuid(),
  content text,
  image_url text,
  tags text[] default '{}',
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- ---------- 新闻（由 GitHub Actions 写入，按 link 去重）----------
create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  link text unique not null,
  source text,
  category text check (category in ('ai','psychology')),
  summary text,
  pub_date timestamptz,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ---------- 小红书内容线（账号名 + 领域）----------
create table if not exists content_lines (
  id uuid primary key default gen_random_uuid(),
  platform text default 'xiaohongshu',
  account_name text not null,
  field text check (field in ('咖啡','单板滑雪','副业')),
  created_at timestamptz default now()
);

-- ---------- 自媒体数据（曝光量 / 点赞量 / 评论量）----------
create table if not exists social_metrics (
  id uuid primary key default gen_random_uuid(),
  line_id uuid references content_lines(id) on delete cascade,
  date date not null,
  impressions bigint default 0,   -- 曝光量
  likes bigint default 0,          -- 点赞量
  comments bigint default 0,       -- 评论量
  note text,
  created_at timestamptz default now(),
  unique (line_id, date)
);

-- ---------- 小红书素材库 ----------
create table if not exists xhs_notes (
  id uuid primary key default gen_random_uuid(),
  title text,
  cover_url text,
  likes bigint default 0,
  tags text[] default '{}',
  note_type text,
  link text,
  remark text,
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- ---------- 咖啡知识点 ----------
create table if not exists coffee_lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  level text default 'basic' check (level in ('basic','advanced')),
  content text,
  is_learned boolean default false,
  sort_order int default 0
);

-- ---------- 咖啡冲煮记录 ----------
create table if not exists coffee_brews (
  id uuid primary key default gen_random_uuid(),
  bean text,
  method text,
  ratio text,
  temp text,
  rating int check (rating between 1 and 5),
  note text,
  date date default current_date,
  created_at timestamptz default now()
);

-- ---------- 猫档案 ----------
create table if not exists cats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  breed text,
  birthday date,
  gender text check (gender in ('公','母')),
  created_at timestamptz default now()
);

-- ---------- 猫咪养护记录 ----------
create table if not exists cat_records (
  id uuid primary key default gen_random_uuid(),
  cat_id uuid references cats(id) on delete cascade,
  type text check (type in ('疫苗','驱虫','体重','就医')),
  date date not null,
  value text,
  next_due date,
  note text,
  created_at timestamptz default now()
);

-- ---------- 索引 ----------
create index if not exists idx_tasks_due      on tasks(due_date) where deleted_at is null;
create index if not exists idx_tasks_status   on tasks(status);
create index if not exists idx_habitlogs_date on habit_logs(date);
create index if not exists idx_news_pub       on news_items(pub_date desc);
create index if not exists idx_news_cat       on news_items(category);
create index if not exists idx_metrics_line   on social_metrics(line_id, date desc);

-- ---------- 开启行级安全 ----------
alter table tasks          enable row level security;
alter table habits         enable row level security;
alter table habit_logs     enable row level security;
alter table inspirations   enable row level security;
alter table news_items     enable row level security;
alter table content_lines  enable row level security;
alter table social_metrics enable row level security;
alter table xhs_notes      enable row level security;
alter table coffee_lessons enable row level security;
alter table coffee_brews   enable row level security;
alter table cats           enable row level security;
alter table cat_records    enable row level security;

-- ---------- 访问策略：一期全放行（单人使用 + 网址不公开）----------
-- 后续若要加登录：把 using (true) 换成 using (auth.uid() is not null)，表结构无需改动
do $$
declare t text;
begin
  foreach t in array array[
    'tasks','habits','habit_logs','inspirations','news_items','content_lines',
    'social_metrics','xhs_notes','coffee_lessons','coffee_brews','cats','cat_records'
  ]
  loop
    execute format('drop policy if exists p_all on %I', t);
    execute format('create policy p_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- 初始化默认习惯（仅表为空时写入）----------
insert into habits (name, icon, color, sort_order)
select v.name, v.icon, v.color, v.sort_order
from (values
  ('早起',  'sun',      '#E8836B', 1),
  ('运动',  'activity', '#7BA88F', 2),
  ('阅读',  'book',     '#8A9BB8', 3),
  ('喝水',  'droplet',  '#6FA8C7', 4),
  ('护肤',  'sparkle',  '#D4A5A5', 5)
) as v(name, icon, color, sort_order)
where not exists (select 1 from habits);

-- ---------- 初始化三条内容线（账号名先占位，之后在页面里改）----------
insert into content_lines (account_name, field)
select v.account_name, v.field
from (values
  ('待填写账号名', '咖啡'),
  ('待填写账号名', '单板滑雪'),
  ('待填写账号名', '副业')
) as v(account_name, field)
where not exists (select 1 from content_lines);

-- ---------- 完成校验 ----------
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
