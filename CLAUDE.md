# CLAUDE.md

Read `AGENTS.md` for the repo's engineering-skill configuration.

## 博客内容操作准则

- **不要更新文章的 updated_at**：通过 driver `set` / `set-body` / `republish` 修改文章时，Drizzle 的 `$onUpdate` 会自动把 `updated_at` 刷成当前时间。每次操作后必须用 raw SQL (`UPDATE posts SET updated_at = published_at WHERE ...`) 归位，再 bump 缓存版本。除非用户主动要求更新编辑时间。
