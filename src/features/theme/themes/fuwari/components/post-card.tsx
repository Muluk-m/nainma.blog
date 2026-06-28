import { ClientOnly, Link } from "@tanstack/react-router";
import { Pin } from "lucide-react";
import { getOptimizedImageUrl } from "@/features/media/utils/media.utils";
import type { PostItem } from "@/features/posts/schema/posts.schema";
import { formatDate } from "@/lib/utils";
import { m } from "@/paraglide/messages";

interface PostCardProps {
  post: PostItem;
  index?: number;
  pinned?: boolean;
}

export function PostCard({ post, index, pinned }: PostCardProps) {
  const tagNames = (post.tags ?? []).map((t) => t.name);

  return (
    <Link
      to="/post/$slug"
      params={{ slug: post.slug }}
      className="group grid grid-cols-[1.75rem_1fr] md:grid-cols-[2rem_1fr] gap-4 md:gap-5 py-8 border-t border-black/8 dark:border-white/10 first:border-t-0"
    >
      <span className="pt-1.5 text-right font-mono text-xs fuwari-text-30 tabular-nums transition-colors group-hover:fuwari-text-50">
        {index !== undefined ? String(index + 1).padStart(2, "0") : ""}
      </span>

      <div className="min-w-0 flex items-start gap-4">
        {post.coverImageKey && (
          <img
            src={getOptimizedImageUrl(post.coverImageKey, 200)}
            alt=""
            loading="lazy"
            className="mt-1 hidden sm:block w-12 h-12 shrink-0 rounded-lg object-cover border border-black/8 dark:border-white/10 [filter:grayscale(.5)_brightness(.99)] transition-[filter] duration-500 group-hover:[filter:grayscale(.15)]"
          />
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-[1.5rem]/snug fuwari-text-90 font-medium">
            {pinned && (
              <Pin
                size={14}
                className="inline align-baseline mr-1.5 -translate-y-px fuwari-text-30 fill-current"
              />
            )}
            <span className="underline-offset-4 decoration-1 decoration-black/20 dark:decoration-white/25 group-hover:underline">
              {post.title}
            </span>
          </h2>

          <p className="mt-2 text-sm/relaxed fuwari-text-50 line-clamp-2">
            {post.summary}
          </p>

          <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 font-mono text-[11.5px] fuwari-text-30">
            <span className="min-w-0 truncate">{tagNames.join(" · ")}</span>
            <span className="shrink-0 tabular-nums whitespace-nowrap">
              <ClientOnly fallback="">{formatDate(post.publishedAt)}</ClientOnly>
              {" · "}
              {m.read_time({ count: post.readTimeInMinutes })}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
