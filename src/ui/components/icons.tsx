import React from "react";

/** Render an SVG icon using innerHTML injection via a wrapper span.
 *  React's dangerouslySetInnerHTML doesn't work directly on <svg> elements,
 *  so we wrap in a span and inject the complete SVG as HTML. */
const ic = (d: string, cls = "") => (
  <span aria-hidden="true" className="inline-flex"
    dangerouslySetInnerHTML={{
      __html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" style="flex-shrink:0">${d}</svg>`,
    }} />
);

export const IconMessageSquare = (c: string) => ic('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', c);
export const IconChevronRight = (c: string) => ic('<path d="m9 18 6-6-6-6"/>', c);
export const IconPlus = (c: string) => ic('<path d="M5 12h14"/><path d="M12 5v14"/>', c);
export const IconX = (c: string) => ic('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', c);
export const IconUserPlus = (c: string) => ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>', c);
export const IconTrash = (c: string) => ic('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>', c);
export const IconSend = (c: string) => ic('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', c);
export const IconMoreH = (c: string) => ic('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', c);
export const IconReply = (c: string) => ic('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', c);
export const IconDollar = (c: string) => ic('<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', c);
export const IconArchive = (c: string) => ic('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>', c);
export const IconRefresh = (c: string) => ic('<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M21 21v-5h-5"/>', c);
export const IconUsers = (c: string) => ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', c);
export const IconBot = (c: string) => ic('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>', c);
