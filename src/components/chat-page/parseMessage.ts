/**
 * Pre-render parser for chat messages.
 *
 * The send route folds attachments into the message body as base64 inside
 * a <attachments>…</attachments> block so the gateway can pass it to the
 * model. We DO NOT want that base64 to render in the UI — it bloats the
 * conversation and exposes binary noise.
 *
 * `parseMessage` strips the attachment block out of the visible text and
 * returns the structured attachments separately for proper chip / thumbnail
 * rendering.
 */

export interface ParsedAttachment {
  name: string;
  mime: string;
  approx_size_kb: number;
  /** base64-encoded body, no `data:` prefix */
  base64: string;
}

export interface ParsedMessage {
  text: string;
  attachments: ParsedAttachment[];
}

const BLOCK_RE = /<attachments>\n([\s\S]*?)\n<\/attachments>/g;
const ITEM_RE = /---\s*attachment\s+([^(]+)\s*\(([^,]+),\s*~?([\d.]+)KB\)\s*---\s*\n+data:[^;]+;base64,([A-Za-z0-9+/=\r\n]+)/g;

export function parseMessage(raw: string): ParsedMessage {
  if (!raw) return { text: '', attachments: [] };

  const attachments: ParsedAttachment[] = [];
  // Find every attachment block and extract its items, then strip the block from text.
  const cleaned = raw.replace(BLOCK_RE, (_, body: string) => {
    let m: RegExpExecArray | null;
    const inner = body;
    ITEM_RE.lastIndex = 0;
    while ((m = ITEM_RE.exec(inner)) !== null) {
      attachments.push({
        name: m[1].trim(),
        mime: m[2].trim(),
        approx_size_kb: Number(m[3]),
        base64: m[4].replace(/\s+/g, ''),
      });
    }
    return ''; // remove the block from the visible text
  }).trim();

  return { text: cleaned, attachments };
}

/** Convenience: dataURL for an image attachment. */
export function attachmentDataUrl(a: ParsedAttachment): string {
  return `data:${a.mime};base64,${a.base64}`;
}
