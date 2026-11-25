import { useEffect, useRef, useState } from "react";
import { Bold, Code2, Link2, Paperclip, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { threadsApi } from "../api/threads.api";
import { RichText } from "./rich-text";

export function Composer({
  base,
  token,
  focusKey,
  reply = false,
  action,
  placeholder,
}: {
  base: string;
  token: string;
  focusKey?: string;
  reply?: boolean;
  action?: React.ReactNode;
  placeholder?: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [files, setFiles] = useState<{ key: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);
  function insert(before: string, after: string, fallback: string) {
    const area = input.current;
    if (!area) return;
    const start = area.selectionStart,
      end = area.selectionEnd;
    setText(
      text.slice(0, start) +
        before +
        (text.slice(start, end) || fallback) +
        after +
        text.slice(end),
    );
    area.focus();
  }
  const toolbar = (
    <div
      className={
        "flex items-center gap-1 border-b border-border/60 bg-muted/25 px-2 py-1.5"
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Bold"
        aria-label="Bold text"
        onClick={() => insert("**", "**", "bold text")}
      >
        <Bold size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Insert link"
        aria-label="Insert link"
        onClick={() => insert("[", "](https://)", "link text")}
      >
        <Link2 size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Code block"
        aria-label="Code block"
        onClick={() => insert("\n```\n", "\n```\n", "code")}
      >
        <Code2 size={16} />
      </Button>
      <label
        className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Attach file"
      >
        <Paperclip size={16} />
        <span className="sr-only">Attach file</span>
        <input
          type="file"
          className="sr-only"
          disabled={uploading || files.length >= 5}
          accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.zip"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setUploading(true);
            setError("");
            try {
              const uploaded = await threadsApi.requestAttachmentUpload(
                base,
                token,
                {
                  fileName: file.name,
                  mimeType: file.type || "application/zip",
                  size: file.size,
                },
              );
              const result = await fetch(uploaded.uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type || "application/zip" },
              });
              if (!result.ok) throw new Error("Upload failed. Try again.");
              setFiles((previous) => [...previous, uploaded]);
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : "Upload failed",
              );
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      <Button
        type="button"
        className="ml-auto"
        variant={preview ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={preview}
        onClick={() => setPreview(!preview)}
      >
        {preview ? "Write" : "Preview"}
      </Button>
    </div>
  );
  return (
    <div
      className={
        reply
          ? "flex min-w-0 flex-1 items-start"
          : "overflow-hidden rounded-xl border border-border/80 bg-card font-normal shadow-sm transition-shadow focus-within:border-[var(--threads-primary)] focus-within:shadow-md"
      }
    >
      <div className="min-w-0 flex-1">
        {!reply && toolbar}
        <label className={preview ? "sr-only" : "block"}>
          <span className="sr-only">Message</span>
          <Textarea
            ref={input}
            name="text"
            required
            maxLength={12000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              placeholder ?? (reply ? "Share context, use cases, or implementation feedback..." : "Share your thoughts…")
            }
            className={
              reply
                ? "min-h-[88px] w-full resize-y rounded-md border border-[var(--threads-border)] bg-[var(--threads-surface)] p-[9px] text-[13px] leading-[19px] shadow-none focus-visible:border-[var(--threads-primary)] focus-visible:ring-2 focus-visible:ring-[var(--threads-primary)]/15"
                : "min-h-36 resize-y rounded-none border-0 bg-transparent px-4 py-3 text-sm leading-6 shadow-none focus-visible:ring-0"
            }
          />
        </label>
        {preview && (
          <div
            className={
              reply ? "min-h-16 px-3 py-2 text-sm" : "min-h-36 px-4 py-3"
            }
          >
            <RichText text={text || "Your message preview appears here."} />
          </div>
        )}
        {files.map((file) => (
          <div
            key={file.key}
            className="flex items-center gap-2 px-3 py-1 text-sm"
          >
            <Paperclip size={14} />
            <span className="truncate">{file.name}</span>
            <input type="hidden" name="attachments" value={file.key} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${file.name}`}
              onClick={() =>
                setFiles(files.filter((item) => item.key !== file.key))
              }
            >
              <X size={14} />
            </Button>
          </div>
        ))}
        {reply ? (
          <div className="flex min-h-12 items-center justify-between gap-2 border-t border-slate-100 px-3 text-slate-500 dark:border-slate-800">
            <span className="text-xs">
              {uploading ? "Uploading attachment…" : "Markdown supported"}
            </span>
            <div className="flex items-center gap-[5px]">
              {action}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {uploading ? "Uploading attachment…" : "Markdown supported"}
            </span>
            <span>{files.length}/5 attachments · 10 MB each</span>
          </div>
        )}
        {uploading && (
          <input
            className="sr-only"
            required
            value=""
            readOnly
            aria-label="Wait for upload to finish"
          />
        )}
        {error && (
          <p role="alert" className="p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
