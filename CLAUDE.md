# CLAUDE.md

Read `AGENTS.md` for the repo's engineering-skill configuration.

## 博客内容操作准则

- **不要更新文章的 updated_at**：通过 driver `set` / `set-body` / `republish` 修改文章时，Drizzle 的 `$onUpdate` 会自动把 `updated_at` 刷成当前时间。每次操作后必须用 raw SQL (`UPDATE posts SET updated_at = published_at WHERE ...`) 归位，再 bump 缓存版本。除非用户主动要求更新编辑时间。

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
