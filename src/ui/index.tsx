import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import {
  usePluginData,
  usePluginAction,
  useHostContext,
  usePluginStream,
} from "@paperclipai/plugin-sdk/ui";
import type { PluginPageProps, PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";

// Shared modules
import type {
  ConversationSummary, ConversationDetail, Message, MsgRef, MessagePage,
  Participant, ReadState, TargetLink, WakePolicy, CostSummary,
  ActiveContextTarget, Agent,
} from "./components/types.js";
import {
  IconMessageSquare, IconPlus, IconX, IconUserPlus, IconTrash,
  IconMoreH, IconReply, IconDollar, IconArchive, IconRefresh, IconUsers, IconBot,
} from "./components/icons.js";
import {
  relativeTime, fmtDate, summarize, fmtCents, fmtTokens, renderMd,
} from "./components/utils.js";
import { useActor, resolveAuthor } from "./components/hooks.js";
import { MentionComposer } from "./components/MentionComposer.js";

// ────────────────────────────────────────────────────────
// InlineAgentSelector — replica of InlineEntitySelector
// ────────────────────────────────────────────────────────

/** Dropdown popover portalled to document.body — escapes ALL overflow ancestors.
 *  Matches paperclip-dev InlineEntitySelector (Radix Popover with portal + collision). */
function PopoverDropdown({ anchorRef, onClose, children }: {
  anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode;
}) {
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reposition = () => {
      const anchor = anchorRef.current;
      const drop = dropRef.current;
      if (!anchor || !drop) return;
      const r = anchor.getBoundingClientRect();
      const dw = drop.offsetWidth || 288;
      const dh = drop.offsetHeight || 200;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = r.bottom + 4;
      let left = r.right - dw;
      if (left < 16) left = 16;
      if (left + dw > vw - 16) left = vw - dw - 16;
      if (top + dh > vh - 16) top = Math.max(16, r.top - dh - 4);
      drop.style.top = top + "px";
      drop.style.left = left + "px";
    };
    reposition();
    requestAnimationFrame(reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [anchorRef]);

  return createPortal(
    <div>
      <div className="fixed inset-0" onClick={onClose} onMouseDown={(e) => e.preventDefault()}
        style={{ zIndex: 9998 }} />
      <div ref={dropRef}
        className="fixed w-[288px] rounded-md border border-border bg-popover shadow-md p-1"
        style={{ zIndex: 9999 }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function InlineAgentSelector({ agents, selected, onAdd, compact }: {
  agents: Agent[]; selected: string[]; onAdd: (id: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const available = useMemo(() => {
    const pool = agents.filter((a) => a.status !== "terminated" && !selected.includes(a.id));
    if (!query.trim()) return pool;
    const q = query.toLowerCase();
    return pool.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, selected, query]);

  useEffect(() => { setHi(0); }, [query]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);

  const commit = (id: string) => { onAdd(id); setQuery(""); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(i + 1, available.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && available[hi]) { e.preventDefault(); commit(available[hi].id); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => { setOpen(!open); setQuery(""); }}
        className={compact
          ? "size-8 justify-center rounded-md border border-border bg-background p-0 shadow-xs inline-flex items-center text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/50 cursor-pointer"
          : "h-9 rounded-full border border-border bg-background px-3 py-2 shadow-xs inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/50 cursor-pointer"
        }
        aria-label="Add participants" title="Add participants">
        {IconUserPlus("h-4 w-4")}
        {!compact && <span>Add participant</span>}
      </button>
      {open && (
        <PopoverDropdown anchorRef={btnRef} onClose={() => setOpen(false)}>
          <input ref={inputRef}
            className="w-full border-b border-border bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60"
            placeholder="Search agents..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} />
          <div className="max-h-56 overflow-y-auto overscroll-contain py-1">
            {available.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {agents.filter((a) => !selected.includes(a.id)).length === 0 ? "All active agents are already added." : "No matching agents."}
              </p>
            ) : available.map((a, i) => (
              <button key={a.id} type="button"
                className={"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm cursor-pointer bg-transparent border-none " + (i === hi ? "bg-accent" : "")}
                onMouseEnter={() => setHi(i)} onClick={() => commit(a.id)}>
                {IconBot("h-3.5 w-3.5 shrink-0 text-muted-foreground")}
                <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
        </PopoverDropdown>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// NewConversationDialog
// ────────────────────────────────────────────────────────

function NewConversationDialog({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const actor = useActor();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const agents = usePluginData<Agent[]>("conversation.agentOptions", { actor, params: { includeTerminated: false } });
  const createAction = usePluginAction("conversation.create");
  useEffect(() => { titleRef.current?.focus(); }, []);
  const selectedAgents = useMemo(() => selected.map((id) => (agents.data ?? []).find((a) => a.id === id)).filter(Boolean) as Agent[], [selected, agents.data]);

  const submit = async () => {
    if (!title.trim() || selected.length === 0 || creating) return;
    setCreating(true); setError(null);
    try { const r = await createAction({ actor, params: { title: title.trim(), participantAgentIds: selected } }) as ConversationDetail; onCreated(r.id); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to create conversation"); }
    finally { setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg w-full sm:max-w-lg p-0" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-muted-foreground/60">&rsaquo;</span><span>New conversation</span>
          </div>
          <button type="button" onClick={onClose}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground bg-transparent border-none cursor-pointer">
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>
        <div className="px-4 pt-4 pb-2">
          <input ref={titleRef} className="w-full text-lg font-semibold bg-transparent outline-none placeholder:text-muted-foreground/50 border-none p-0"
            placeholder="Conversation title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="px-4 pb-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Participants</p>
            <p className="text-xs text-muted-foreground">Add the agents who should be able to see and respond in this conversation.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAgents.map((a) => (
              <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs">
                {IconBot("h-3.5 w-3.5 shrink-0 text-muted-foreground")}
                <span className="truncate">{a.name}</span>
                <button type="button" className="text-muted-foreground transition-colors hover:text-foreground bg-transparent border-none cursor-pointer p-0"
                  onClick={() => setSelected((p) => p.filter((x) => x !== a.id))} aria-label={`Remove ${a.name}`}>
                  {IconX("h-3.5 w-3.5")}
                </button>
              </span>
            ))}
            <InlineAgentSelector agents={agents.data ?? []} selected={selected} onAdd={(id) => setSelected((p) => p.includes(id) ? p : [...p, id])} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground text-muted-foreground bg-transparent border-none cursor-pointer">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={creating || !title.trim() || selected.length === 0}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none border-none cursor-pointer">
            {IconMessageSquare("mr-1.5 h-4 w-4")}
            {creating ? "Creating..." : "Create conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// MessageRow
// ────────────────────────────────────────────────────────

const MessageRow = memo(function MessageRow({ msg, uid, names, icons, onReply, onDelete, deletingId }: {
  msg: Message; uid: string | null; names: Map<string, string>; icons: Map<string, string | null>;
  onReply: (m: Message) => void; onDelete: (m: Message) => void; deletingId: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const author = resolveAuthor(msg, uid, names);
  const isOwn = msg.authorType === "user" && !!uid && msg.authorUserId === uid;
  const isAgent = msg.authorType === "agent";
  const delPending = deletingId === msg.id;
  const stampedRefs = msg.refs.filter((r) => r.refOrigin === "active_context" && r.refKind !== "agent");

  if (msg.authorType === "system") return (
    <div className="w-full py-4">
      <div className="max-w-4xl">
        <span className="inline-flex rounded-full bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground" title={fmtDate(msg.createdAt)}>
          <span>{relativeTime(msg.createdAt)}</span><span className="mx-1.5">&middot;</span><span>System</span>
        </span>
        {!msg.deletedAt && <div className="mt-3 text-sm text-foreground" dangerouslySetInnerHTML={{ __html: renderMd(msg.bodyMarkdown) }} />}
      </div>
    </div>
  );

  return (
    <div className="w-full py-4">
      <div className={"max-w-4xl" + (isOwn ? " ml-auto text-right" : "")}>
        {/* Header */}
        <div className={"mb-2 flex items-center gap-2" + (isOwn ? " justify-end" : "")}>
          {isAgent ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary/30 border border-primary" />
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                {(msg.authorAgentId ? icons.get(msg.authorAgentId) : null) ?? author.charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-xs font-medium">{author}</span>
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {!isOwn && <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />}
              <span className="text-xs font-medium">{author}</span>
            </span>
          )}
          <span className="text-xs text-muted-foreground" title={fmtDate(msg.createdAt)}>{relativeTime(msg.createdAt)}</span>
          <span className="text-xs text-muted-foreground">#{msg.sequence}</span>
          {/* Actions dropdown — portalled to body, matches paperclip-dev DropdownMenu */}
          <div className="relative">
            <button ref={menuBtnRef} type="button" onClick={() => setMenuOpen(!menuOpen)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground opacity-0 group-hover:opacity-100 bg-transparent border-none cursor-pointer"
              aria-label="Message actions">
              {IconMoreH("h-4 w-4")}
            </button>
            {menuOpen && (
              <PopoverDropdown anchorRef={menuBtnRef} onClose={() => setMenuOpen(false)}>
                  <button type="button" disabled={!!msg.deletedAt}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent text-left bg-transparent border-none cursor-pointer disabled:opacity-50"
                    onClick={() => { onReply(msg); setMenuOpen(false); }}>
                    {IconReply("h-4 w-4")} Reply to
                  </button>
                  <button type="button" disabled={!!msg.deletedAt || delPending}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-destructive/10 text-destructive text-left bg-transparent border-none cursor-pointer disabled:opacity-50"
                    onClick={() => { onDelete(msg); setMenuOpen(false); }}>
                    {IconTrash("h-4 w-4")} {delPending ? "Deleting..." : "Delete message"}
                  </button>
              </PopoverDropdown>
            )}
          </div>
        </div>

        {/* Body */}
        <div className={isOwn ? "ml-auto w-fit max-w-3xl text-left" : "max-w-3xl pl-8"}>
          {msg.parentSummary && msg.parentId && (() => {
            // Parse parent message details (JSON-encoded by the service)
            let parentInfo: { sequence?: number; authorType?: string; authorUserId?: string | null; authorAgentId?: string | null; bodyMarkdown?: string; deletedAt?: string | null } | null = null;
            try { parentInfo = JSON.parse(msg.parentSummary); } catch { /* old format: plain text */ }
            const parentAuthor = parentInfo
              ? resolveAuthor({ authorType: parentInfo.authorType ?? "user", authorUserId: parentInfo.authorUserId ?? null, authorAgentId: parentInfo.authorAgentId ?? null, authorDisplayName: null }, uid, names)
              : null;
            return (
              <div className="mb-3 rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-left">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Replying to {parentAuthor ?? "…"} &middot; #{parentInfo?.sequence ?? msg.parentId.slice(0, 8)}
                </p>
                <div className="min-w-0">
                  {parentInfo?.deletedAt ? (
                    <p className="mt-1 truncate text-xs italic text-muted-foreground">This message was deleted.</p>
                  ) : (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {summarize(parentInfo?.bodyMarkdown ?? msg.parentSummary, 200)}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
          <div className="text-sm leading-6 text-foreground">
            {msg.deletedAt
              ? <p className="italic text-muted-foreground">This message was deleted.</p>
              : <span dangerouslySetInnerHTML={{ __html: renderMd(msg.bodyMarkdown) }} />}
          </div>
          {stampedRefs.length > 0 && (
            <div className={"mt-3 flex flex-wrap items-center gap-2" + (isOwn ? " justify-end" : "")}>
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Linked context</span>
              {stampedRefs.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs">
                  <span className="font-medium uppercase tracking-wide text-muted-foreground">{r.refKind}</span>
                  <span className="text-foreground">{r.displayText}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ────────────────────────────────────────────────────────
// ConversationThread
// ────────────────────────────────────────────────────────

function ConversationThread({ conversation, companyId }: { conversation: ConversationDetail; companyId: string }) {
  const actor = useActor();
  const uid = actor.userId;
  const cid = conversation.id;

  const [replyId, setReplyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastMarkedRef = useRef(0);
  const lastScrolledRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const thread = usePluginData<MessagePage>("conversation.thread", { actor, params: { conversationId: cid, limit: 50 } });
  const sendAction = usePluginAction("conversation.sendMessage");
  const deleteAction = usePluginAction("conversation.deleteMessage");
  const markReadAction = usePluginAction("conversation.markRead");

  // Poll for new messages every 5 seconds (streams return 501 on current host)
  useEffect(() => {
    const interval = setInterval(() => { thread.refresh(); }, 5000);
    return () => clearInterval(interval);
  }, [cid]);

  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  const hasMore = thread.data?.hasMoreBefore ?? false;

  const names = useMemo(() => { const m = new Map<string, string>(); for (const p of conversation.participants) m.set(p.agentId, p.agentName); return m; }, [conversation.participants]);
  const icons = useMemo(() => { const m = new Map<string, string | null>(); for (const p of conversation.participants) m.set(p.agentId, p.agentIcon); return m; }, [conversation.participants]);
  const replyTarget = useMemo(() => replyId ? messages.find((m) => m.id === replyId) ?? null : null, [messages, replyId]);

  useEffect(() => { lastMarkedRef.current = 0; lastScrolledRef.current = null; setReplyId(null); setSendErr(null); setDelErr(null); }, [cid]);
  useEffect(() => { if (replyId && replyTarget?.deletedAt) setReplyId(null); }, [replyId, replyTarget]);

  // Read state
  useEffect(() => {
    const srvSeq = conversation.viewerReadState?.lastReadSequence ?? 0;
    if (lastMarkedRef.current > srvSeq) lastMarkedRef.current = srvSeq;
  }, [conversation.viewerReadState?.lastReadSequence]);
  useEffect(() => {
    if (!conversation || !uid) return;
    const latestSeq = messages[messages.length - 1]?.sequence ?? conversation.lastMessageSequence;
    const lastRead = conversation.viewerReadState?.lastReadSequence ?? 0;
    if (latestSeq > lastRead && latestSeq > 0 && lastMarkedRef.current < latestSeq) {
      lastMarkedRef.current = latestSeq;
      markReadAction({ actor, params: { conversationId: cid, lastReadSequence: latestSeq } }).catch(() => { });
    }
  }, [conversation, messages]);

  // Auto scroll
  useEffect(() => {
    const lid = messages[messages.length - 1]?.id ?? null;
    if (!lid || lid === lastScrolledRef.current) return;
    const b = lastScrolledRef.current ? "smooth" : "auto";
    lastScrolledRef.current = lid;
    bottomRef.current?.scrollIntoView({ behavior: b as ScrollBehavior });
  }, [cid, messages]);

  const handleSend = useCallback(async (body: string, parentId: string | null, targets: ActiveContextTarget[]) => {
    if (!body || sending) return;
    setSending(true); setSendErr(null);
    try {
      await sendAction({ actor, params: { conversationId: cid, bodyMarkdown: body, parentId, activeContextTargets: targets } });
      setReplyId(null); thread.refresh();
    } catch (e) { setSendErr(e instanceof Error ? e.message : "Failed to send message"); }
    finally { setSending(false); }
  }, [cid, sending, actor]);

  const handleDelete = useCallback(async (msg: Message) => {
    if (msg.deletedAt) return;
    setDeletingId(msg.id); setDelErr(null);
    try { await deleteAction({ actor, params: { conversationId: cid, messageId: msg.id } }); if (replyId === msg.id) setReplyId(null); thread.refresh(); }
    catch (e) { setDelErr(e instanceof Error ? e.message : "Failed to delete"); }
    finally { setDeletingId(null); }
  }, [cid, replyId]);

  const handleReply = useCallback((msg: Message) => { if (!msg.deletedAt) setReplyId(msg.id); }, []);
  const hint = conversation.participants.length === 0
    ? "No participants yet. Add an agent from the properties panel to give this conversation a responder."
    : null;

  // Scroll handler — load older messages when scrolled near top
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || thread.loading) return;
    if (el.scrollTop < 120) {
      // Would trigger older page load — but plugin SDK doesn't support
      // infinite query pagination, so this is a visual hint only for now
    }
  }, [hasMore, thread.loading]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2">
      {hint && (
        <div className="px-4 sm:px-6">
          <div className="rounded-lg border border-border bg-background/70 px-3 py-2 text-sm">
            <p className="text-muted-foreground">{hint}</p>
          </div>
        </div>
      )}

      {/* Messages scroll area */}
      <div className="min-h-0 flex-1 overflow-hidden w-full">
        {messages.length === 0 && !thread.loading ? (
          <div className="flex h-full min-h-[20rem] items-center justify-center">
            <div className="text-center text-muted-foreground">
              {IconMessageSquare("h-8 w-8 mx-auto mb-2 opacity-30")}
              <p className="text-sm">No messages yet.</p>
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto px-6 sm:px-4" onScroll={handleScroll}>
            <div className="py-2">
              {(hasMore || thread.loading) && messages.length > 0 && (
                <div className="pb-2 text-center text-xs text-muted-foreground">
                  {thread.loading ? "Loading older messages..." : "Scroll up to load earlier messages"}
                </div>
              )}
              {thread.loading && messages.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">Loading messages...</div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className="group">
                  <MessageRow msg={msg} uid={uid} names={names} icons={icons} onReply={handleReply} onDelete={handleDelete} deletingId={deletingId} />
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* Composer with @mention support */}
      <MentionComposer
        conversation={conversation}
        replyTarget={replyTarget}
        onClearReply={() => setReplyId(null)}
        onSend={handleSend}
        sending={sending}
        sendErr={sendErr}
        delErr={delErr}
        hint={hint}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────
// SidebarMetricRow
// ────────────────────────────────────────────────────────

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// PropertiesPanel
// ────────────────────────────────────────────────────────

function PropertiesPanel({ conversation, onRefresh }: { conversation: ConversationDetail; onRefresh: () => void }) {
  const actor = useActor();
  const [wpDraft, setWpDraft] = useState<WakePolicy | null>(null);
  const agents = usePluginData<Agent[]>("conversation.agentOptions", { actor, params: { includeTerminated: false } });
  const addAction = usePluginAction("conversation.addParticipant");
  const removeAction = usePluginAction("conversation.removeParticipant");
  const updateAction = usePluginAction("conversation.update");

  const wp = wpDraft ?? conversation.wakePolicy;
  const wpChanged = wpDraft && JSON.stringify(wpDraft) !== JSON.stringify(conversation.wakePolicy);
  const pids = new Set(conversation.participants.map((p) => p.agentId));

  const handleAdd = async (agentId: string) => { await addAction({ actor, params: { conversationId: conversation.id, agentId } }); onRefresh(); };
  const handleRemove = async (agentId: string) => { await removeAction({ actor, params: { conversationId: conversation.id, agentId } }); onRefresh(); };
  const saveWp = async () => { if (!wpDraft) return; await updateAction({ actor, params: { conversationId: conversation.id, wakePolicy: wpDraft } }); setWpDraft(null); onRefresh(); };

  return (
    <aside className="hidden md:flex border-l border-border bg-card flex-col shrink-0 overflow-hidden w-80 min-w-[320px]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-sm font-medium">Properties</span>

      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-4 p-4">

          {/* Wake policy */}
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Wake policy</p>
              <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                <p><span className="font-medium text-foreground">Broad wakeups:</span> level 1 wakes most often, and each higher level wakes less often.</p>
                <p><span className="font-medium text-foreground">Agent wakes:</span> the agent-human step lowers agent-authored wakes, and each report-to hop adds the hierarchy step.</p>
                <p><span className="font-medium text-foreground">Direct messages:</span> mentions and reply-to messages still only target the intended agent.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Agent-human step</span>
                <input type="number" min={0} max={10} step={1} value={wp.agentHumanStep}
                  onChange={(e) => setWpDraft({ ...wp, agentHumanStep: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-ring" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Hierarchy step</span>
                <input type="number" min={0} max={10} step={1} value={wp.hierarchyStep}
                  onChange={(e) => setWpDraft({ ...wp, hierarchyStep: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-ring" />
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wake chances</p>
              {wp.wakeChancePercents.map((pct, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                  <input type="number" min={0} max={100} step={1} value={pct}
                    onChange={(e) => { const n = [...wp.wakeChancePercents]; n[i] = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)); setWpDraft({ ...wp, wakeChancePercents: n }); }}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-ring" />
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">%</span>
                  {wp.wakeChancePercents.length > 1 && (
                    <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground bg-transparent border-none cursor-pointer"
                      onClick={() => setWpDraft({ ...wp, wakeChancePercents: wp.wakeChancePercents.filter((_, j) => j !== i) })}>
                      {IconTrash("h-3.5 w-3.5")}
                    </button>
                  )}
                </div>
              ))}
              <p className="text-xs leading-5 text-muted-foreground">Level 1 is the highest priority. You can add up to 10 levels.</p>

            </div>
            <div className="flex justify-between">
              <button type="button" disabled={wp.wakeChancePercents.length >= 10}
                className="w-full inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
                onClick={() => { const last = wp.wakeChancePercents[wp.wakeChancePercents.length - 1] ?? 100; setWpDraft({ ...wp, wakeChancePercents: [...wp.wakeChancePercents, Math.max(0, last - 20)] }); }}>
                Add level
              </button>
              <button type="button" disabled={!wpChanged}
                className="w-full inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
                onClick={saveWp}>
                Save Policy
              </button>
            </div>
          </div>

          <hr className="border-t border-border" />

          {/* Participants */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">{IconUsers("h-4 w-4 text-muted-foreground")}<p className="text-sm font-medium text-foreground">Participants</p></div>
              <InlineAgentSelector agents={agents.data ?? []} selected={[...pids]}
                onAdd={(id) => handleAdd(id)} compact />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Only listed agents can see this conversation and receive wakeups when new messages arrive.</p>
          </div>

          {conversation.participants.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No participants yet. Add an agent above.</div>
          ) : (
            <div className="max-h-[50dvh] overflow-y-auto rounded-lg border border-border/60">
              <div className="space-y-1 p-1">
                {conversation.participants.map((p) => (
                  <div key={p.agentId} className="rounded-lg px-2 py-2 transition-colors hover:bg-accent/40">
                    <div className="flex items-start gap-2">
                      {IconBot("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground")}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{p.agentTitle ?? p.agentName}</div>
                        {(p.agentModel || p.agentThinkingEffort) && (
                          <div className="truncate text-xs text-muted-foreground">{[p.agentModel, p.agentThinkingEffort].filter(Boolean).join(" - ")}</div>
                        )}
                      </div>
                      {conversation.participants.length > 1 && (
                        <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground bg-transparent border-none cursor-pointer"
                          onClick={() => handleRemove(p.agentId)}>
                          {IconTrash("h-3.5 w-3.5")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <hr className="border-t border-border" />

          {/* Spend */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">{IconDollar("h-4 w-4 text-muted-foreground")}<p className="text-sm font-medium text-foreground">Spend</p></div>
            <p className="text-xs leading-5 text-muted-foreground">Conversation usage totals and recent billing activity.</p>
          </div>
          <div className="space-y-1">
            <MetricRow label="Total spend" value={fmtCents(conversation.costSummary.spendCents)} />
            <MetricRow label="Runs" value={String(conversation.costSummary.runCount)} />
            <MetricRow label="Input tokens" value={fmtTokens(conversation.costSummary.inputTokens)} />
            <MetricRow label="Output tokens" value={fmtTokens(conversation.costSummary.outputTokens)} />
            <MetricRow label="Last usage" value={conversation.costSummary.lastOccurredAt ? fmtDate(conversation.costSummary.lastOccurredAt) : "No usage yet"} />
          </div>

          <hr className="border-t border-border" />

          {/* Status */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">{IconMessageSquare("h-4 w-4 text-muted-foreground")}<p className="text-sm font-medium text-foreground">Status</p></div>
            <p className="text-xs leading-5 text-muted-foreground">Conversation state and recent activity.</p>
          </div>
          <div className="space-y-1">
            <MetricRow label="Status" value={conversation.status.replace(/_/g, " ")} />
            <MetricRow label="Messages" value={String(conversation.lastMessageSequence)} />
            <MetricRow label="Updated" value={fmtDate(conversation.updatedAt)} />
            <button type="button"
              className="mt-2 w-full inline-flex items-center justify-start gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
              onClick={async () => { await updateAction({ actor, params: { conversationId: conversation.id, status: conversation.status === "archived" ? "active" : "archived" } }); onRefresh(); }}>
              {conversation.status === "archived" ? IconRefresh("h-4 w-4") : IconArchive("h-4 w-4")}
              {conversation.status === "archived" ? "Reopen conversation" : "Archive conversation"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ────────────────────────────────────────────────────────
// ConversationsPage — mirrors paperclip-dev ConversationDetail
// No list page. This is the conversation detail page.
// Accessed via /:companyPrefix/conversations?conversationId=X
// ────────────────────────────────────────────────────────

export function ConversationsPage(_props: PluginPageProps) {
  const actor = useActor();
  const ctx = useHostContext();
  const [showNew, setShowNew] = useState(false);
  const [showPanel, setShowPanel] = useState(true);

  // Read conversationId from URL query param
  const conversationId = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get("conversationId"); }
    catch { return null; }
  }, []);

  // Detect ?action=new to auto-open create dialog
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("action") === "new") {
        setShowNew(true);
        const u = new URL(window.location.href);
        u.searchParams.delete("action");
        window.history.replaceState({}, "", u.toString());
      }
    } catch { /* ignore */ }
  }, []);

  // Persist UI state
  const selectAction = usePluginAction("conversation.selectConversation");
  useEffect(() => {
    if (conversationId) {
      selectAction({ actor, params: { conversationId, targetKind: null, targetId: null } }).catch(() => { });
    }
  }, [conversationId]);

  // Load conversation detail
  const convDetail = usePluginData<ConversationDetail>(
    "conversation.get",
    conversationId ? { actor, params: { conversationId } } : undefined,
  );

  // Stream invalidation
  const stream = usePluginStream<{ type: string; conversationId: string }>(
    conversationId ? `conversation:${conversationId}` : "conversation:__noop__",
    { companyId: actor.companyId },
  );
  useEffect(() => {
    if (stream.lastEvent?.conversationId === conversationId) convDetail.refresh();
  }, [stream.lastEvent]);

  const navigateToConv = (id: string) => {
    if (ctx.companyPrefix) window.location.href = `/${ctx.companyPrefix}/conversations?conversationId=${id}`;
  };

  // No conversationId → empty state (user got here without selecting a conversation)
  if (!conversationId) {
    return (
      <div className="flex h-full min-h-[calc(100dvh-12rem)] flex-col items-center justify-center gap-2 md:min-h-0">
        <div className="text-center text-muted-foreground">
          {IconMessageSquare("h-8 w-8 mx-auto mb-2 opacity-30")}
          <p className="text-sm">Select a conversation from the sidebar, or create a new one.</p>
        </div>
        {showNew && (
          <NewConversationDialog
            onCreated={(id) => { setShowNew(false); navigateToConv(id); }}
            onClose={() => setShowNew(false)} />
        )}
      </div>
    );
  }

  // Loading
  if (!convDetail.data && convDetail.loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading conversation...</div>;
  }

  // Error / not found
  if (!convDetail.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          {IconMessageSquare("h-8 w-8 mx-auto mb-2 opacity-30")}
          <p className="text-sm">Conversation not found.</p>
        </div>
      </div>
    );
  }

  // Conversation detail — matches paperclip-dev ConversationDetail layout
  return (
    <div className="flex h-full min-h-[calc(100dvh-12rem)] md:min-h-0">
      {/* Main content — flex column for thread layout */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar with properties toggle */}
        <div className="flex items-center justify-end px-4 sm:px-6">
          <button type="button" onClick={() => setShowPanel(!showPanel)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground bg-transparent border-none cursor-pointer"
            aria-label="Open conversation properties" title="Open conversation properties">
            {IconMoreH("h-4 w-4")}
          </button>
        </div>

        {/* ConversationThread fills remaining space with its own flex column */}
        <ConversationThread conversation={convDetail.data} companyId={actor.companyId} />
      </div>

      {/* Properties panel */}
      {showPanel && (
        <PropertiesPanel conversation={convDetail.data} onRefresh={() => convDetail.refresh()} />
      )}

      {showNew && (
        <NewConversationDialog
          onCreated={(id) => { setShowNew(false); navigateToConv(id); }}
          onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// ConversationsSidebar
// ────────────────────────────────────────────────────────

export function ConversationsSidebar(_props: PluginSidebarProps) {
  const ctx = useHostContext();
  const actor = useActor();
  const [open, setOpen] = useState(true);
  const convList = usePluginData<ConversationSummary[]>("conversation.list", { actor, params: { status: "active", limit: 50 } });
  const activeId = (() => { try { const pm = window.location.pathname.match(/conversations\/([^/]+)/); if (pm) return pm[1]; return new URLSearchParams(window.location.search).get("conversationId"); } catch { return null; } })();
  const go = (id: string) => { if (ctx.companyPrefix) window.location.href = `/${ctx.companyPrefix}/conversations?conversationId=${id}`; };

  return (
    <div>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 flex-1 min-w-0 bg-transparent border-none cursor-pointer p-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={"h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100 " + (open ? "rotate-90" : "")} aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">Conversations</span>
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); if (ctx.companyPrefix) window.location.href = `/${ctx.companyPrefix}/conversations?action=new`; }}
            className="flex items-center justify-center h-4 w-4 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent/50 transition-colors bg-transparent border-none cursor-pointer"
            aria-label="New conversation">{IconPlus("h-3 w-3")}</button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-0.5 mt-0.5">
          {(convList.data ?? []).map((c) => (
            <a key={c.id} onClick={(e) => { e.preventDefault(); go(c.id); }}
              href={ctx.companyPrefix ? `/${ctx.companyPrefix}/conversations?conversationId=${c.id}` : "#"}
              className={"flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium transition-colors no-underline " +
                (activeId === c.id ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50 hover:text-foreground")}>
              {IconMessageSquare("shrink-0 h-3.5 w-3.5 text-muted-foreground")}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="max-w-[7rem] shrink-0 truncate text-[11px] font-normal text-muted-foreground">{c.latestMessageAt ? relativeTime(c.latestMessageAt) : "No messages yet"}</span>
              </span>
              {c.unreadCount > 0 && <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none text-primary-foreground">{c.unreadCount > 99 ? "99+" : c.unreadCount}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
