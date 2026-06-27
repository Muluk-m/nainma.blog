---
name: run-nainma-blog
description: Upload, write, and publish blog posts to nainma.blog from a markdown file. Use when asked to publish a post, post a new blog/article, create a draft, push a write-up live, list/get/delete posts, or screenshot a published post. Drives the site's built-in MCP server via .claude/skills/run-nainma-blog/driver.mjs.
---

# Publish to nainma.blog

This blog has a built-in MCP server (`https://blog.nainma.online/mcp`) with
post tools (`posts_create_draft`, `posts_update`, `posts_set_tags`,
`posts_set_visibility`, `posts_get`, `posts_delete`). The driver wraps the full
"write a markdown file → create draft → fill body → tag → publish live" flow
into one command.

**Use `driver.mjs`, not the `mcp__nainma-blog__*` tools.** Those Claude Code MCP
tools lose their OAuth flow state between conversation turns (you'll loop on
"No OAuth flow is in progress"). The driver does its own OAuth — dynamic client
registration + PKCE + refresh token — and **persists the PKCE verifier to disk**,
so a two-step authorize survives across turns. Authenticate once; the cached
token auto-refreshes after that.

Paths below are relative to the repo root. The driver lives at
`.claude/skills/run-nainma-blog/driver.mjs`.

## 写作风格（写正文时务必遵守）

博主要求：博客正文不要带「AI 生成感」的套路句式。写或改正文时**避免**以下中文写作痕迹（这是博主明确反馈的，不是建议）：

- **「不是…而是…」/「不只是…而是…」/「并非…而是…」** 这类对比排比句式 → 改成直述。
  - ✗ 「它不是又一层封装，而是把它重新建模了一次。」
  - ✓ 「换句话说，它把这件事重新建模了一次。」
- **「硬骨头」「绕不开的那个 X」** 这类拔高/煽情的比喻词 → 用平实表达。
- 更广义地，避免常见的 AI 行文 tells：三段排比（rule of three）凑数、空泛升华、「值得一提的是」「不仅…更…」、过度使用破折号制造转折。

写完后自查一遍：`grep -nE '不是.{0,20}而是|不只是.{0,20}而是|并非.{0,15}而是|硬骨头' <file.md>` 应无命中。需要去 AI 味时可配合 `humanizer` skill。

## Prerequisites

- Node 18+ (has global `fetch`/`crypto`) or `bun`. No `npm install` — the driver
  uses only Node built-ins.
- Credentials cache lives in `.cache/nainma-cli/` (already gitignored via
  `.cache/`). The OAuth token never enters git.

## Authenticate (once)

The site OAuth redirects to `http://localhost:8976/callback`. In a remote /
container session that page won't load — that's expected; you only need the URL.

```bash
# Step 1 — print the authorization URL, hand it to the user:
node .claude/skills/run-nainma-blog/driver.mjs auth-url

# User opens it, clicks authorize, browser lands on a localhost page that
# fails to load. They copy the FULL address-bar URL back to you. Then:
node .claude/skills/run-nainma-blog/driver.mjs auth-paste "http://localhost:8976/callback?code=...&state=..."
# ✓ authenticated; token cached in .cache/nainma-cli/
```

On your own machine where the browser can reach localhost, one command does both:

```bash
node .claude/skills/run-nainma-blog/driver.mjs auth    # opens a local callback server on :8976
```

Verify the token:

```bash
node .claude/skills/run-nainma-blog/driver.mjs whoami
# ✓ token works. total reachable posts (sample): 1
```

## Publish a post (agent path)

Write a markdown file with frontmatter, then publish it. Frontmatter keys:
`title` (falls back to the first `# H1`), `slug` (optional — server generates
one if omitted), `summary`, `tags` (comma list or `[a, b]`). Body is plain
markdown.

```bash
cat > /tmp/my-post.md <<'EOF'
---
title: My Post Title
slug: my-post-slug
summary: One-line summary shown in listings.
tags: react, cloudflare
---

# My Post Title

Body in **markdown**. Lists, code blocks, etc. all work.
EOF

node .claude/skills/run-nainma-blog/driver.mjs publish /tmp/my-post.md
# · created draft #N
# · filled "My Post Title" (slug: my-post-slug)
# · tags: react, cloudflare
# · published (status: published, workflow queued: true)
# ✓ live: https://blog.nainma.online/posts/my-post-slug
```

Save as a draft instead of publishing (same fill+tag, no go-live):

```bash
node .claude/skills/run-nainma-blog/driver.mjs draft /tmp/my-post.md
```

## Other commands

```bash
node .claude/skills/run-nainma-blog/driver.mjs list                 # 20 most-recent posts
node .claude/skills/run-nainma-blog/driver.mjs list --status draft  # only drafts
node .claude/skills/run-nainma-blog/driver.mjs get 3                # full post incl. markdown body
node .claude/skills/run-nainma-blog/driver.mjs delete 5            # delete by id
```

Edit an existing post **in place** (no new post created — use this to fix a
published post instead of delete + re-publish):

```bash
# metadata: keys are title | slug | summary | status
node .claude/skills/run-nainma-blog/driver.mjs set 6 "title=New Title" summary="新摘要"
# replace the markdown body from a file:
node .claude/skills/run-nainma-blog/driver.mjs set-body 6 /tmp/revised.md
```

## Smoke test (verify the whole pipeline)

Creates a throwaway post, publishes it, reads it back, and deletes it — proves
auth + every tool end to end. Safe: it cleans up after itself.

```bash
node .claude/skills/run-nainma-blog/driver.mjs smoke
# · created draft #N
# · published #N status=published queued=true
# · verified slug=smoke-driver-... status=published
# · cleaned up #N
# ✓ smoke passed: create→update→tag→publish→get→delete
```

## Screenshot a published post

After `publish` prints `✓ live: <url>`, screenshot it with the browse skill /
`chromium-cli`, e.g. `chromium-cli screenshot <url> --output /tmp/post.png`.

## Gotchas

- **Don't use the `mcp__nainma-blog__*` tools for this.** Their OAuth flow state
  is per-process and is dropped between turns — `complete_authentication` then
  reports "No OAuth flow is in progress." The driver sidesteps this by writing
  the PKCE verifier + state to `.cache/nainma-cli/pending.json`, so `auth-url`
  and `auth-paste` can run in different turns.
- **Publishing is live and immediate.** `posts_set_visibility` queues the
  publish workflow and the post is reachable at `/posts/<slug>` right away.
  There is no staging. Use `draft` while iterating; `publish` only when ready.
- **`publish`/`smoke` always create a NEW post** (each run calls
  `posts_create_draft`). To edit an existing post by id, use the MCP
  `posts_update` tool directly or extend the driver — the file-based commands
  don't update in place.
- **Tags are created on demand.** `posts_set_tags` takes tag *names*; unknown
  ones are auto-created. It *replaces* all tags on the post, not append.
- **Slug collisions:** publishing a second post with a slug that already exists
  will fail server-side. Pick unique slugs or omit `slug` to let the server
  generate one.
- **`list` search is title/summary only**, not full-text — don't rely on it to
  find a post by body content or slug; page through recent posts instead.

## Troubleshooting

- `not authenticated; run auth-url then auth-paste` → no cached token yet. Run
  the two-step auth above.
- `refresh failed: ... — re-run auth-url` → the refresh token expired/revoked.
  Re-run `auth-url` + `auth-paste`.
- `state mismatch` on `auth-paste` → you ran `auth-url` again after the one you
  authorized. Re-run `auth-url` and use that fresh URL.
- `MCP ... -> 401` → token rejected (revoked app authorization). Delete
  `.cache/nainma-cli/token.json` and re-authenticate.
- Pointing at a different deployment: set `NAINMA_BLOG_URL` (and, if needed,
  `NAINMA_REDIRECT_URI`) before any command.
