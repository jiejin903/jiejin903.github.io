# 我的工作台 · life-hub

单文件网页应用（零外部依赖），电脑手机打开同一网址即可用，数据存 Supabase，多端实时同步。

**正式地址（GitHub Pages，永久在线）**：https://jiejin903.github.io/life-hub/
**备用地址**：https://workbuddy.link/p/cS5BFCRNKydVUSvPT73ldp

---

## 一、三件事让它真正跑起来

### 1. 无需配置，已经接好了 ✅
Project URL 和 publishable key 都写进页面了（2026-09-13 验证通过）：

- Project URL：`https://xcsyowhmkumycyxhcgrw.supabase.co`
- 14 张表已建，RLS 已开，15 个 RSS 源已预置，新闻已抓到 279 条

**手机端**打开同一个网址就能同步，不用再填任何东西。

### 2. 给 GitHub Actions 配密钥（做 RSS 自动更新用）
仓库 → Settings → Secrets and variables → Actions → New repository secret，加两个：

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://<你的项目ref>.supabase.co` |
| `SUPABASE_KEY` | `sb_publishable_...`（正式值见 `index.html` 里的 `CFG`，或 Supabase 后台 Settings → API） |

配好后到 Actions →「RSS 每日抓取」→ Run workflow 手动跑一次验证，之后每天北京时间 07:00 自动执行。

---

## 二、功能

| 阶段 | 模块 | 说明 |
|---|---|---|
| P0 | 首页 | 日期、今日待办 Top3、习惯九宫格、完成率环、模块入口、悬浮「+」 |
| P0 | 每日工作 | 逾期 / 今日 / 本周 / 无截止日 / 已完成 分组，逾期红色置顶 +「全部改到今天」 |
| P0 | 打卡 | 自定义习惯（图标·颜色·排序·启停）、连续天数、月度热力图、14 天完成率曲线 |
| P0 | 同步 | 乐观更新 + 离线队列，断网可用、恢复后自动重试；顶部「N 条待同步」 |
| P1 | 个人灵感 | 文字 + 图片 + 标签，标签筛选与全文搜索 |
| P1 | 新闻资讯 | 15 个 RSS 源（AI 9 + 心理学 6），每日 07:00 自动抓取去重；来源/领域筛选、已读标记、一键存灵感 |
| P1 | 自媒体数据 | 小红书内容线（咖啡 / 单板滑雪 / 副业），曝光·点赞·评论，趋势图 + 环比 |
| P1 | 小红书素材库 | 笔记卡片，搜索 + 标签筛选 + 复制文案 |
| P2 | 咖啡时间 | 知识点分级目录 + 已学标记 + 冲煮记录（豆种/器具/粉水比/水温/评分） |
| P2 | 猫咪养护 | 档案 + 疫苗/驱虫/体重/就医时间线 + 到期提醒 + 通用知识 |

## 三、关键约定

- **进入口令**：自己在「设置 → 进入口令」里改，别用默认值
- **软删除**：任务、灵感、素材删除后进「设置 → 最近删除」，30 天内可恢复
- **备份**：设置页可导出 JSON 全量备份 / 各模块 CSV
- **手机当 App 用**：浏览器菜单 → 添加到主屏幕
- **删除策略**：软删除保留 30 天

## 四、文件说明

```
index.html                 单文件应用（CSS/JS/图标全内联）
scripts/fetch-rss.mjs      RSS 抓取脚本（零依赖，携带浏览器 UA）
scripts/sources.json       默认 15 个 RSS 源清单
supabase_extra.sql         rss_sources / rss_runs 建表 + 预置源
data/news.json             抓取快照兜底（无数据库时页面可读）
.github/workflows/rss-daily.yml  每日 07:00 定时任务
```

## 五、已知限制（不虚构）

- **PsyPost** 源在部分网络环境被 Cloudflare 拦 403，已按「单源失败不影响其他源」处理，页面顶部会提示失败源数量；GitHub Actions（美国 IP）大概率正常。
- anon key 写在前端是 Supabase 官方允许做法，但**不等于安全**：拿到网址 + 扒前端 JS 就能读写。真正的行级隔离要接 Supabase Auth，届时只需把 policy 里的 `true` 改成 `auth.uid() is not null`，表结构不用动。
- 小红书无公开接口，数据手动录入或由 AI 整理后导入，不做爬取。

## 六、维护机制（2026-10-13 起）

| 自动化 | 频率 | 做什么 |
|---|---|---|
| 工作台周报 | 每周五 18:00 | 体检 + 全量拉数 + 本周/上周环比 + 信号识别 + 下周建议；生成企业微信智能文档（不推送消息） |
| 在线体检 + 保活 | 每天 09:00 | curl 页面与数据库；读一次库即为保活，防止免费项目 7 天无活动被暂停。异常才写文件 |

**⚠️ 2026-10-13 事故**：Supabase 免费项目因长期无请求被暂停，域名解析失效。
恢复方式：登录 Dashboard 点 Restore → 执行 `supabase_rebuild.sql` 还原全部表与内容。
根治方式：给 GitHub PAT，把 Actions 定时任务跑起来（每日 07:00 抓 RSS 天然保活）。

## 七、部署状态（如实记录）

| 项 | 状态 |
|---|---|
| 工作台页面 | ✅ GitHub Pages：https://jiejin903.github.io/life-hub/ ｜ 备用：https://workbuddy.link/p/cS5BFCRNKydVUSvPT73ldp |
| Supabase 云端同步 | ✅ 已打通并端到端验证（新增 201 / 读回 200 / 完成 204 / 软删 204 / 恢复 204 / 打卡重复写入 409 被唯一约束拦住） |
| 数据库 | ✅ 14 张表（12 业务表 + rss_sources / rss_runs），RLS 已开 |
| 新闻数据 | ✅ 已真实抓取 279 条入库（14/15 源成功，仅 PsyPost 403） |
| GitHub Pages | ⏸ 阻塞：本机钥匙串存的是**账号密码**，GitHub 已禁用密码推送。需一个 PAT（repo 权限），脚本已备好 |
| GitHub Actions 定时任务 | ⏸ 同上；Secrets 加 `SUPABASE_URL` / `SUPABASE_KEY` 即可跑 |

**PsyPost 源**在当前网络被 Cloudflare 拦 403（UA 已带），已按「单源失败不影响其他源」隔离，页面顶部会提示失败源数量。
