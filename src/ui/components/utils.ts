export function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export function summarize(t: string, max = 120) {
  const n = t.replace(/\s+/g, " ").trim();
  return n.length <= max ? n : n.slice(0, max - 1) + "\u2026";
}

export function fmtCents(c: number | null) {
  return c == null ? "\u2014" : "$" + (c / 100).toFixed(2);
}

export function fmtTokens(n: number | null) {
  return n == null ? "\u2014" : n.toLocaleString();
}

// Bot icon SVG for agent mention chip mask
const BOT_ICON_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
);

function renderMentionChip(label: string, href: string, kind: string, targetId: string): string {
  let styleAttr = "";
  if (kind === "agent") {
    styleAttr = ` style="--paperclip-mention-icon-mask: url(&quot;data:image/svg+xml,${BOT_ICON_SVG}&quot;)"`;
  }
  return `<a href="${href}" class="paperclip-mention-chip" contenteditable="false" data-mention-kind="${kind}" data-mention-target-id="${targetId}"${styleAttr}>${label}</a>`;
}

export function renderMd(md: string): string {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, "<pre class='mt-2 mb-2 rounded-md bg-muted p-3 text-xs overflow-x-auto'><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code class='rounded bg-muted px-1 py-0.5 text-xs'>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^&gt;\s?(.*)$/gm, "<blockquote class='border-l-2 border-border pl-3 text-muted-foreground my-2'>$1</blockquote>")
    // Structured mention links → render as paperclip-mention-chip
    .replace(
      /\[([^\]]+)\]\((agent|issue|goal|project):\/\/([a-f0-9-]+)(?:\?[^)]*?)?\)/g,
      (_match, label, kind, targetId) => renderMentionChip(label, `${kind}://${targetId}`, kind, targetId),
    )
    // Regular links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>')
    .replace(/\n/g, "<br>");
}

export function extractTargets(md: string): Array<{ targetKind: string; targetId: string; displayText: string }> {
  const re = /\[([^\]]+)\]\((issue|goal|project):\/\/([a-f0-9-]+)(?:\?[^)]*?)?\)/g;
  const t: Array<{ targetKind: string; targetId: string; displayText: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) t.push({ targetKind: m[2], targetId: m[3], displayText: m[1] });
  return t;
}
