// Hand-rolled parser for the flat-scalar YAML frontmatter used by Claude Code
// agent .md files. We deliberately do NOT pull in a YAML dependency: the shape is
// verified to be flat scalars only (no block scalars, no lists), so a first-colon
// line splitter + zod validation is safer and lighter than a full YAML engine.
//
// Field order varies across files and `description` values contain colons, so we
// split each line on the FIRST colon only and never re-order.
import { z } from "zod";

/** Validated frontmatter. `color` is optional; everything else is normalized. */
export const frontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  tools: z.array(z.string()),
  model: z.string(),
  color: z.string().optional(),
});

export type Frontmatter = z.infer<typeof frontmatterSchema>;

/**
 * Parse a raw `.md` string into validated frontmatter.
 * Throws if the file has no frontmatter block or fails zod validation — callers
 * treat a throw as a per-file "error" status (fault isolation).
 *
 * Field-level omissions inside a valid block are tolerated via fallbacks:
 *   missing/empty name  -> fallbackName (usually the filename stem)
 *   missing tools       -> []
 *   missing model       -> "inherit"
 *   missing description -> ""
 */
export function parseFrontmatter(raw: string, fallbackName: string): Frontmatter {
  const block = extractFrontmatterBlock(raw);
  if (block === null) {
    throw new Error("No YAML frontmatter block found");
  }
  const fields = parseBlock(block);

  return frontmatterSchema.parse({
    name: fields.name && fields.name.length > 0 ? fields.name : fallbackName,
    description: fields.description ?? "",
    model: fields.model && fields.model.length > 0 ? fields.model : "inherit",
    tools: splitList(fields.tools),
    ...(fields.color ? { color: fields.color } : {}),
  });
}

/** Extract the text between the leading `---` fence and the next `---`. */
function extractFrontmatterBlock(raw: string): string | null {
  const normalized = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---/.exec(normalized);
  return match ? match[1] : null;
}

/** Split a frontmatter block into a lowercased key -> raw scalar value map. */
function parseBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue; // not a "key: value" scalar line
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!key) continue;
    out[key] = unquote(line.slice(idx + 1).trim());
  }
  return out;
}

/** Split a comma-separated scalar (e.g. tools) into trimmed, non-empty tokens. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Strip a single pair of matching surrounding quotes if present. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}
