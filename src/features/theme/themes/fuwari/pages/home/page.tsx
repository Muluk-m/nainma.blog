import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { PostItem } from "@/features/posts/schema/posts.schema";
import type { HomePageProps } from "@/features/theme/contract/pages";
import { m } from "@/paraglide/messages";
import { PostCard } from "../../components/post-card";

export function HomePage({ posts, pinnedPosts }: HomePageProps) {
  const mergedPosts = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ post: PostItem; pinned: boolean }> = [];

    for (const post of pinnedPosts ?? []) {
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      result.push({ post, pinned: true });
    }
    for (const post of posts) {
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      result.push({ post, pinned: false });
    }

    return result;
  }, [posts, pinnedPosts]);

  return (
    <div className="pt-8 md:pt-12">
      <div className="flex flex-col">
        {mergedPosts.map(({ post, pinned }, i) => (
          <PostCard key={post.slug} post={post} index={i} pinned={pinned} />
        ))}
      </div>

      <div className="mt-8 border-t border-black/8 dark:border-white/10 pt-8">
        <Link
          to="/posts"
          className="font-mono text-xs fuwari-text-50 hover:text-(--fuwari-primary) transition-colors"
        >
          {m.home_view_all_posts()} →
        </Link>
      </div>
    </div>
  );
}
