# 封面图设计标准

nainma.blog 已发布文章的统一封面规范。新文章按此生成，保持视觉一致。

## 风格

- 主题：现代扁平漫画插画
- 配色：浅蓝 + 白为主，明快柔和
- 描边：干净的黑色线条，扁平质感
- 主角：每篇用**贴合主题的物件 / 场景**当主角（不固定同一个角色，避免每张雷同）
- 串场配角：白色方形、带笑脸和小手小脚的「数据卡片」小角色，串联各篇
- 不使用：机器人、真人
- 无文字
- 调性：轻松友好

## 规格

- 比例：16:9（卡片 `aspect-video`、详情页 `aspect-[16/9]`）
- 尺寸：ark `2560x1440`（原生 16:9）
- 格式：JPG
- 后端：ark / doubao-seedream（漫画插画质感最佳）

## 各篇母题

| 文章 | R2 key | 主角母题 |
|---|---|---|
| Claude Code 提示词演变 | `cover-claude-code-prompt-v3.jpg` | 越拉越长的清单卷轴 |
| LangGraph 状态图 | `cover-langgraph-deep-dive-v3.jpg` | 节点 + 箭头路线图 |
| Agent 权限网关 | `cover-agent-permission-gateway-v3.jpg` | 安检闸门 + 持钥匙的数据卡片 |
| 工单 RAG Chunk | `cover-rag-chunk-v3.jpg` | 表格被剪刀裁成整齐卡片堆 |
| CSR→SSG 迁移 | `cover-csr-to-ssg-v3.jpg` | 乱箱子搬上整齐货架 |

源图存档：`docs/covers/`。

## 生成命令

```bash
node ~/.claude/skills/image-gen/scripts/cli.mjs \
  "现代扁平漫画插画风格，科技博客封面。浅蓝色与白色为主的明快配色，干净的黑色描边，扁平插画质感，轻松友好，画面无任何文字，16:9 横版。可串场的配角：白色方形带笑脸小手小脚的数据卡片。画面里不出现机器人、也不出现人物。场景：<每篇母题>" \
  --provider ark --size 2560x1440 --output <dir>
```

## 上线

1. 上传 R2：`wrangler r2 object put nainma-blog-media/<key> --file <jpg> --content-type image/jpeg --remote`
2. 设封面 **并刷新缓存**：
   - `driver set <id> coverImageKey=<key>`
   - `driver republish <id>`

> ⚠️ 关键：`set`（走 `posts_update`）只写数据库、**不刷新缓存**。文章详情页有 7 天 KV 缓存 + CDN 缓存，只有走「发布 workflow」才会失效。所以改完封面（或标题/正文）后必须 `republish` 一次，否则详情页一直显示旧内容。
