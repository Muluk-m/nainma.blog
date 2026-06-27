import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Loader2, RefreshCw, X } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { uploadImageFn } from "@/features/media/api/media.api";
import { getOptimizedImageUrl } from "@/features/media/utils/media.utils";
import { m } from "@/paraglide/messages";

interface PostEditorCoverImageProps {
  coverImageKey: string | null;
  onChange: (coverImageKey: string | null) => void;
}

export function PostEditorCoverImage({
  coverImageKey,
  onChange,
}: PostEditorCoverImageProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      return await uploadImageFn({ data: formData });
    },
    onSuccess: (result) => {
      if (result.error || !result.data) {
        toast.error(m.media_upload_error_db());
        return;
      }
      onChange(result.data.key);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : m.request_error_unknown_title(),
      );
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    // 清空以便重复选择同一文件也能触发 change
    e.target.value = "";
  };

  const openPicker = () => inputRef.current?.click();
  const isUploading = uploadMutation.isPending;

  return (
    <div className="col-span-1 space-y-3 md:col-span-3">
      <label className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        {m.editor_meta_cover()}
      </label>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {coverImageKey ? (
        <div className="group relative w-full max-w-md overflow-hidden rounded-sm border border-border/30">
          <img
            src={getOptimizedImageUrl(coverImageKey, 800)}
            alt={m.editor_meta_cover()}
            className="aspect-video w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center gap-4 bg-black/50 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={openPicker}
              disabled={isUploading}
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/90 transition-colors hover:text-white disabled:opacity-60"
            >
              {isUploading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {m.editor_meta_cover_replace()}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-white/90 transition-colors hover:text-white"
            >
              <X size={12} />
              {m.editor_meta_cover_remove()}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          disabled={isUploading}
          className="flex aspect-video w-full max-w-md flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border/40 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <ImagePlus size={18} />
          )}
          <span className="text-[10px] font-mono uppercase tracking-wider">
            {m.editor_meta_cover_upload()}
          </span>
        </button>
      )}
    </div>
  );
}
