# CLAUDE.md

Read `AGENTS.md` for the repo's engineering-skill configuration.

## 博客内容操作准则

- **不要更新文章的 updated_at**：通过 driver `set` / `set-body` / `republish` 修改文章时，Drizzle 的 `$onUpdate` 会自动把 `updated_at` 刷成当前时间。每次操作后必须用 raw SQL (`UPDATE posts SET updated_at = published_at WHERE ...`) 归位，再 bump 缓存版本。除非用户主动要求更新编辑时间。
- **长文发布会卡在代码高亮（Free plan CPU 限制）**：文章代码块多/语言杂时，发布 workflow 的 `build public content` 步骤（shiki 高亮）会超 Workers Free plan 的 CPU 限制反复失败，症状是文章页 503（error 1102）、`get` 显示 `isSynced: false`。解法：本地跑 `node scripts/rebuild-post-snapshot.mjs <postId>`，它会在本地完成高亮并把快照、sync hash、KV/CDN 缓存失效、搜索索引一次补齐。**这类文章每次改动 content 后都必须重跑该脚本**（workflow 的跳过路径靠 hash 匹配，内容一变 hash 失配 → workflow 又会去撞 CPU 限制并且不会更新快照）。不要给 wrangler 配 `limits.cpu_ms`——Free plan 不支持，部署会失败。

## 博客写作语癖黑名单

写或修改文章正文时，禁用下列 AI 常用语（博主逐条点名过，硬性要求）：

- 「不是…而是…」「不只是…而是…」「并非…而是…」这类对比排比 → 改直述。
- 「硬骨头」「绕不开的那个 X」这类拔高/煽情比喻 → 用平实表达。
- 「把话说透」「把话说全」 → 改「讲清楚」「说明白」。
- 「值得一提的是」「不仅…更…」、三段排比凑数、空泛升华、过度用破折号制造转折。

发布前自查（应无命中）：

```bash
grep -nE '不是.{0,20}而是|不只是.{0,20}而是|并非.{0,15}而是|硬骨头|把?话?说[透全]|值得一提' <file.md>
```
