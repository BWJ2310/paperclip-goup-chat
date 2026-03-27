export type StructuredMentionKind = "agent" | "issue" | "goal" | "project";

export interface ParsedStructuredMentionHref {
  kind: StructuredMentionKind;
  targetId: string;
  color: string | null;
}

export interface StructuredMentionToken extends ParsedStructuredMentionHref {
  displayText: string;
  href: string;
}

const MENTION_HREF_RE = /^(agent|issue|goal|project):\/\/([a-f0-9-]+)(?:\?c=([a-fA-F0-9]{6}))?$/;

export function buildStructuredMentionHref(
  kind: StructuredMentionKind,
  targetId: string,
  color?: string | null,
): string {
  let href = `${kind}://${targetId}`;
  if (color) href += `?c=${color}`;
  return href;
}

export function parseStructuredMentionHref(
  href: string,
): ParsedStructuredMentionHref | null {
  const m = MENTION_HREF_RE.exec(href);
  if (!m) return null;
  return {
    kind: m[1] as StructuredMentionKind,
    targetId: m[2],
    color: m[3] ?? null,
  };
}

const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function extractStructuredMentionTokens(
  markdown: string,
): StructuredMentionToken[] {
  const tokens: StructuredMentionToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = MD_LINK_RE.exec(markdown)) !== null) {
    const displayText = match[1];
    const href = match[2];
    const parsed = parseStructuredMentionHref(href);
    if (parsed) {
      tokens.push({ ...parsed, displayText, href });
    }
  }
  return tokens;
}

export function extractStructuredMentionIds(
  markdown: string,
  kind: StructuredMentionKind,
): string[] {
  return extractStructuredMentionTokens(markdown)
    .filter((t) => t.kind === kind)
    .map((t) => t.targetId);
}
