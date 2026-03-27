import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { Message, ActiveContextTarget, ConversationDetail } from "./types.js";
import { IconSend, IconX } from "./icons.js";
import { summarize, extractTargets } from "./utils.js";
import { useActor, resolveAuthor } from "./hooks.js";

function buildMentionHref(kind: string, id: string): string {
  return `${kind}://${id}`;
}

interface MentionOption {
  id: string;
  name: string;
  kind: "agent" | "issue" | "goal" | "project";
}

const MENTION_KINDS = [
  { key: "agent", label: "Agent" },
  { key: "issue", label: "Issue" },
  { key: "goal", label: "Goal" },
  { key: "project", label: "Project" },
] as const;

const KIND_LABELS: Record<string, string> = { agent: "Agent", issue: "Issue", goal: "Goal", project: "Project" };

interface MentionComposerProps {
  conversation: ConversationDetail;
  replyTarget: Message | null;
  onClearReply: () => void;
  onSend: (body: string, parentId: string | null, targets: ActiveContextTarget[]) => Promise<void>;
  sending: boolean;
  sendErr: string | null;
  delErr: string | null;
  hint: string | null;
}

/** Convert contenteditable HTML back to markdown */
function htmlToMarkdown(container: HTMLElement): string {
  let md = "";
  for (let ci = 0; ci < container.childNodes.length; ci++) {
    const node = container.childNodes[ci];
    if (node.nodeType === Node.TEXT_NODE) {
      md += node.textContent ?? "";
    } else if (node instanceof HTMLAnchorElement && node.dataset.mentionKind) {
      const kind = node.dataset.mentionKind;
      const targetId = node.dataset.mentionTargetId ?? "";
      const label = node.textContent?.replace(/^@/, "") ?? "";
      md += `[@${label}](${kind}://${targetId})`;
    } else if (node instanceof HTMLBRElement) {
      md += "\n";
    } else if (node instanceof HTMLDivElement) {
      // contenteditable wraps new lines in <div>
      if (md.length > 0 && !md.endsWith("\n")) md += "\n";
      md += htmlToMarkdown(node);
    } else if (node instanceof HTMLElement) {
      md += node.textContent ?? "";
    }
  }
  return md;
}

export function MentionComposer({
  conversation, replyTarget, onClearReply, onSend, sending, sendErr, delErr, hint,
}: MentionComposerProps) {
  const actor = useActor();
  const uid = actor.userId;
  const editorRef = useRef<HTMLDivElement>(null);

  // Mention state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionKind, setMentionKind] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  // Load mention options
  const mentionSearch = usePluginData<ActiveContextTarget[]>(
    "conversation.targetPickerOptions",
    mentionActive && mentionKind && mentionKind !== "agent" ? {
      actor,
      params: { q: mentionQuery || "a", allowedKinds: [mentionKind] },
    } : undefined,
  );

  // Agent options from participants
  const agentOptions = useMemo<MentionOption[]>(() => {
    if (mentionKind !== "agent") return [];
    const q = mentionQuery.toLowerCase();
    return conversation.participants
      .filter((p) => !q || p.agentName.toLowerCase().includes(q))
      .map((p) => ({ id: p.agentId, name: p.agentName, kind: "agent" as const }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [conversation.participants, mentionKind, mentionQuery]);

  const entityOptions = useMemo<MentionOption[]>(() => {
    if (mentionKind === "agent" || !mentionKind) return [];
    return ((mentionSearch.data as unknown as ActiveContextTarget[]) ?? [])
      .slice(0, 8)
      .map((t) => ({ id: t.targetId, name: t.displayText, kind: mentionKind as "issue" | "goal" | "project" }));
  }, [mentionSearch.data, mentionKind]);

  const options = mentionKind === "agent" ? agentOptions : entityOptions;
  const kindPickerOptions = useMemo(() => {
    if (mentionKind !== null) return [];
    return MENTION_KINDS.filter((k) => !mentionQuery || k.key.startsWith(mentionQuery.toLowerCase()));
  }, [mentionKind, mentionQuery]);

  useEffect(() => { setMentionIdx(0); }, [mentionQuery, mentionKind]);

  // Detect @ mention from contenteditable
  const detectMention = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { setMentionActive(false); return; }
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) { setMentionActive(false); return; }
    // Don't detect inside mention chips
    if ((textNode.parentElement as HTMLElement)?.closest?.("a")) { setMentionActive(false); return; }

    const text = textNode.textContent ?? "";
    const offset = range.startOffset;
    let atPos = -1;
    for (let i = offset - 1; i >= 0; i--) {
      if (text[i] === "@") { if (i === 0 || /\s/.test(text[i - 1])) atPos = i; break; }
      if (/\s/.test(text[i])) break;
    }
    if (atPos === -1) { setMentionActive(false); return; }

    const query = text.slice(atPos + 1, offset);
    const colonIdx = query.indexOf(":");
    if (colonIdx >= 0) {
      const kindStr = query.slice(0, colonIdx).toLowerCase();
      const valid = MENTION_KINDS.find((k) => k.key === kindStr);
      if (valid) {
        setMentionActive(true);
        setMentionKind(valid.key);
        setMentionQuery(query.slice(colonIdx + 1));
        return;
      }
    }
    if (query.length <= 20 && !query.includes(" ") && !query.includes("\n")) {
      setMentionActive(true);
      setMentionKind(null);
      setMentionQuery(query);
    } else {
      setMentionActive(false);
    }
  }, []);

  // Replace the @query text with a mention chip
  const insertMention = useCallback((opt: MentionOption) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent ?? "";
    const offset = range.startOffset;
    // Find the @ position
    let atPos = -1;
    for (let i = offset - 1; i >= 0; i--) {
      if (text[i] === "@") { atPos = i; break; }
    }
    if (atPos === -1) return;

    // Create the mention chip element
    const chip = document.createElement("a");
    chip.href = buildMentionHref(opt.kind, opt.id);
    chip.className = "paperclip-mention-chip";
    chip.setAttribute("contenteditable", "false");
    chip.setAttribute("data-mention-kind", opt.kind);
    chip.setAttribute("data-mention-target-id", opt.id);
    chip.textContent = `@${opt.name}`;
    // Set CSS variable for the ::before icon mask (agent = bot icon SVG)
    if (opt.kind === "agent") {
      const botSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"></path><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M2 14h2"></path><path d="M20 14h2"></path><path d="M15 13v2"></path><path d="M9 13v2"></path></svg>`;
      chip.style.setProperty("--paperclip-mention-icon-mask", `url("data:image/svg+xml,${encodeURIComponent(botSvg)}")`);
    }

    // Replace @query text with the chip
    const before = text.slice(0, atPos);
    const after = text.slice(offset);
    const beforeNode = document.createTextNode(before);
    const afterNode = document.createTextNode("\u00A0" + after);
    const parent = textNode.parentNode!;
    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(chip, textNode);
    parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    // Move cursor after the chip
    const newRange = document.createRange();
    newRange.setStart(afterNode, 1);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setMentionActive(false);
    setMentionKind(null);
    setMentionQuery("");
  }, []);

  const selectKind = useCallback((kind: string) => {
    // Replace the @query text with @kind: so user can continue typing
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent ?? "";
    const offset = range.startOffset;
    let atPos = -1;
    for (let i = offset - 1; i >= 0; i--) {
      if (text[i] === "@") { atPos = i; break; }
    }
    if (atPos === -1) return;

    const newText = text.slice(0, atPos) + `@${kind}:` + text.slice(offset);
    textNode.textContent = newText;
    const newOffset = atPos + kind.length + 2;
    const newRange = document.createRange();
    newRange.setStart(textNode, newOffset);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setMentionKind(kind);
    setMentionQuery("");
  }, []);

  const handleInput = useCallback(() => { detectMention(); }, [detectMention]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (!mentionActive) {
      if (e.key === "Enter" && !e.shiftKey) {
        // Allow normal enter for newlines in contenteditable
      }
      return;
    }
    const items = mentionKind === null ? kindPickerOptions : options;
    if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (mentionKind === null) { if (kindPickerOptions[mentionIdx]) selectKind(kindPickerOptions[mentionIdx].key); }
      else { if (options[mentionIdx]) insertMention(options[mentionIdx]); }
    }
    else if (e.key === "Escape") { setMentionActive(false); }
  }, [mentionActive, mentionKind, kindPickerOptions, options, mentionIdx, selectKind, insertMention]);

  const handleSend = useCallback(async () => {
    const el = editorRef.current;
    if (!el || sending) return;
    const md = htmlToMarkdown(el).replace(/\u00A0/g, " ").trim();
    if (!md) return;
    const targets = extractTargets(md);
    await onSend(md, replyTarget?.id ?? null, targets);
    el.innerHTML = "";
  }, [sending, onSend, replyTarget]);

  const replyAuthor = replyTarget ? resolveAuthor(replyTarget, uid, new Map(
    conversation.participants.map((p) => [p.agentId, p.agentName]),
  )) : null;

  return (
    <div className="sticky bottom-0 z-10 px-4 pt-2 sm:px-6 md:bottom-0">
      <div className="mx-auto w-full">
        <div className="border border-border bg-background/95 shadow-lg backdrop-blur-sm">
          <div className="px-3 py-3">
            {replyTarget && (
              <div className="mb-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Replying to {replyAuthor} &middot; #{replyTarget.sequence}
                    </p>
                    <p className="mt-1 truncate text-sm text-foreground">
                      {replyTarget.deletedAt ? "This message was deleted." : summarize(replyTarget.bodyMarkdown)}
                    </p>
                  </div>
                  <button type="button" onClick={onClearReply}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground bg-transparent border-none cursor-pointer">
                    {IconX("h-4 w-4")}
                  </button>
                </div>
              </div>
            )}

            {/* Contenteditable editor with mention chip rendering */}
            <div className="relative">
              <div ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                data-placeholder="Ask, direct, or reply with linked work context..."
                className="min-h-[7rem] text-sm leading-6 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50" />

              {/* Mention dropdown — matches paperclip-dev MarkdownEditor */}
              {mentionActive && (mentionKind === null ? kindPickerOptions.length > 0 : true) && (
                <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[180px] max-h-[200px] overflow-y-auto rounded-md border border-border bg-popover shadow-md"
                  onMouseDown={(e) => e.preventDefault()}>
                  {mentionKind === null ? (
                    kindPickerOptions.map((k, i) => (
                      <button key={k.key} type="button"
                        className={"flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/50 bg-transparent border-none cursor-pointer " + (i === mentionIdx ? "bg-accent" : "")}
                        onMouseEnter={() => setMentionIdx(i)}
                        onPointerDown={(e) => { e.preventDefault(); selectKind(k.key); }}>
                        <span className="text-muted-foreground">@</span>
                        <span>{k.label}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">Kind</span>
                      </button>
                    ))
                  ) : options.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {mentionSearch.loading ? "Loading mentions..." : `No matching ${mentionKind} results.`}
                    </div>
                  ) : (
                    options.map((opt, i) => (
                      <button key={opt.id} type="button"
                        className={"flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent/50 transition-colors bg-transparent border-none cursor-pointer " + (i === mentionIdx ? "bg-accent" : "")}
                        onMouseEnter={() => setMentionIdx(i)}
                        onPointerDown={(e) => { e.preventDefault(); insertMention(opt); }}>
                        {opt.kind === "project" ? (
                          <span className="inline-flex h-2 w-2 rounded-full border border-border/50 bg-muted-foreground" />
                        ) : (
                          <span className="text-muted-foreground">@</span>
                        )}
                        <span>{opt.name}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                          {KIND_LABELS[opt.kind] ?? opt.kind}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {hint ? "No participants yet. Messages won\u2019t wake any agents until you add one." : "Use @ to mention agents, issues, goals, or projects."}
            </p>
            <button type="button" onClick={handleSend} disabled={sending}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none border-none cursor-pointer">
              {IconSend("mr-1.5 h-4 w-4")} {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
        {sendErr && <p className="mt-3 text-sm text-destructive">{sendErr}</p>}
        {delErr && <p className="mt-3 text-sm text-destructive">{delErr}</p>}
      </div>
    </div>
  );
}
