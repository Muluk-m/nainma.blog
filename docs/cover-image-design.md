# 封面图设计标准

nainma.blog 已发布文章的统一封面规范。新文章按此生成，保持视觉一致。

## 风格

- 主题：极简暗色 · 纯抽象
- 背景：近纯黑深炭色（near-black / deep charcoal）
- 主体：白 / 浅灰细线几何 + 节点，线条克制，大量留白
- 无文字、无字母、无数字
- 调性：高级技术杂志感，呼应博客 zinc 极简调性

## 规格

- 比例：16:9（卡片 `aspect-video`、详情页 `aspect-[16/9]`）
- 尺寸：gpt `1536x1024`（3:2，容器内居中裁切）；要原生 16:9 用 ark `2560x1440`
- 格式：PNG
- 后端：gpt-image-2 `--quality high`（线条风格还原最佳）

## 构图母题

每篇一个母题，统一横向 left→right 叙事：

| 文章 | R2 key | 母题 |
|---|---|---|
| Claude Code 提示词演变 | `cover-claude-code-prompt.png` | 左侧细单链向右渐密、分叉成网络（版本累积） |
| LangGraph 状态图 | `cover-langgraph-deep-dive.png` | 有向状态图 + 箭头 + 反馈回路 |
| Agent 权限网关 | `cover-agent-permission-gateway.png` | 节点经唯一窄闸，少数放行（default-deny） |
| 工单 RAG Chunk | `cover-rag-chunk.png` | 规整网格向右溶解成结构化块 |
| CSR→SSG 迁移 | `cover-csr-to-ssg.png` | 散乱星座向右收敛进有序网格 |

源图存档：`docs/covers/`。

## 生成命令

```bash
node ~/.claude/skills/image-gen/scripts/cli.mjs \
  "Minimalist abstract editorial cover illustration, near-black deep charcoal background, delicate monochrome line work in white and muted gray, thin fine strokes, small circular nodes connected by thin lines, abundant empty negative space, absolutely no text no letters no numbers no words, refined restraint, high-end technical magazine aesthetic, matte flat finish, 16:9 horizontal composition. Central motif: <母题>" \
  --provider gpt --quality high --size 1536x1024 --output <dir>
```

## 上线

1. 上传 R2：`wrangler r2 object put nainma-blog-media/<key> --file <png> --content-type image/png --remote`
2. 设封面：经 admin 编辑器上传，或 MCP `posts_update { id, coverImageKey: "<key>" }`（走应用层，缓存正确失效）
