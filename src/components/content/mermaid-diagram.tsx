import { memo, useEffect, useId, useState } from "react";

interface MermaidDiagramProps {
  code: string;
}

type RenderState =
  | { status: "loading" }
  | { status: "done"; svg: string }
  | { status: "error" };

/**
 * 在客户端把 mermaid 源码渲染成 SVG。
 *
 * mermaid 依赖浏览器 DOM 测量文本/布局，无法在 Cloudflare Workers 的
 * SSR 环境运行，因此这里用动态 import + useEffect 仅在浏览器渲染，
 * 并随明暗主题（html.dark）切换重新生成。
 */
export const MermaidDiagram = memo(function MermaidDiagram({
  code,
}: MermaidDiagramProps) {
  const [state, setState] = useState<RenderState>({ status: "loading" });
  // useId 含冒号等非法字符，清洗后作为 mermaid 渲染节点 id
  const rawId = useId();

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const source = code.trim();

    async function renderDiagram() {
      if (!source) {
        if (!cancelled) setState({ status: "error" });
        return;
      }
      try {
        // mermaid 体积约 3MB，打进 Worker 会超 Cloudflare 免费版 3 MiB 限制，
        // 改为浏览器运行时从 CDN 以 ESM 动态加载（变量 URL + @vite-ignore，构建不打包它）。
        const mermaidCdnUrl =
          "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
        const mermaid = (await import(/* @vite-ignore */ mermaidCdnUrl))
          .default;
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isDark ? "dark" : "default",
        });
        const { svg } = await mermaid.render(renderId, source);
        if (!cancelled) setState({ status: "done", svg });
      } catch (e) {
        console.warn(
          JSON.stringify({
            event: "mermaid_render_failed",
            error: e instanceof Error ? e.message : String(e),
          }),
        );
        if (!cancelled) setState({ status: "error" });
      }
    }

    renderDiagram();

    // 明暗主题切换时（html class 变化）重新渲染
    const observer = new MutationObserver(() => {
      renderDiagram();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [code, rawId]);

  // 渲染失败：回退到原始代码块，保证内容不丢失
  if (state.status === "error") {
    return (
      <pre className="my-12 overflow-x-auto rounded-sm border border-destructive/30 bg-muted/30 p-6 font-mono text-sm leading-relaxed text-muted-foreground custom-scrollbar">
        <code>{code}</code>
      </pre>
    );
  }

  // SSR / 首次客户端渲染前的占位，保持 hydration 一致
  if (state.status === "loading") {
    return (
      <div className="my-12 flex min-h-[120px] items-center justify-center rounded-sm border border-zinc-200/40 dark:border-zinc-800/40 text-xs font-mono text-muted-foreground/60">
        <span className="animate-pulse">Rendering diagram…</span>
      </div>
    );
  }

  return (
    // svg 由 mermaid 在 strict 模式（内置 DOMPurify 清洗）下生成，可安全注入
    <div
      className="mermaid-diagram my-12 flex justify-center overflow-x-auto rounded-sm border border-zinc-200/40 dark:border-zinc-800/40 bg-white dark:bg-zinc-900/40 p-6 custom-scrollbar [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
});
