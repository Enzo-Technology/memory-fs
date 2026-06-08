import type Database from "better-sqlite3";
import {
  type Memory,
  type MemoryRow,
  type MemoryType,
  rowToMemory,
} from "./db.js";
import { deriveKey, normalizeKey, normalizeNamespace } from "./slug.js";
import { parseWikilinks } from "./wikilinks.js";

export type OnConflict = "overwrite" | "append" | "error";
export type BrowseKind =
  | "index"
  | "recent"
  | "hubs"
  | "orphans"
  | "tags"
  | "tagged"
  | "namespaces";

export interface NoteInput {
  namespace: string;
  content: string;
  key?: string;
  type?: MemoryType;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  on_conflict?: OnConflict;
}

export interface NearDuplicate {
  namespace: string;
  key: string;
  score: number;
  snippet: string;
}

export interface NoteResult extends Memory {
  near_duplicate_warning?: NearDuplicate[];
  size_warning?: string;
}

export interface RecallInput {
  query: string;
  namespace?: string;
  type?: MemoryType;
  tags?: string[];
  limit?: number;
  since?: string;
}

export interface BrowseInput {
  kind: BrowseKind;
  namespace?: string;
  prefix?: string;
  limit?: number;
  tag?: string;
}

export interface RecentItem {
  namespace: string;
  key: string;
  type: MemoryType;
  updated_at: string;
  snippet: string;
}
export interface HubItem extends RecentItem {
  in_degree: number;
}
export interface OrphanItem extends RecentItem { }
export interface TagItem {
  tag: string;
  count: number;
}
export interface NamespaceItem {
  namespace: string;
  count: number;
}
export interface IndexSection {
  section: "recent" | "tags" | "namespaces";
  items: RecentItem[] | TagItem[] | NamespaceItem[];
}

export type BrowseResult =
  | { kind: "index"; total: number; items: IndexSection[] }
  | { kind: "recent"; total: number; items: RecentItem[] }
  | { kind: "hubs"; total: number; items: HubItem[] }
  | { kind: "orphans"; total: number; items: OrphanItem[] }
  | { kind: "tags"; total: number; items: TagItem[] }
  | { kind: "tagged"; total: number; items: RecentItem[] }
  | { kind: "namespaces"; total: number; items: NamespaceItem[] };

export interface Backlink {
  from_namespace: string;
  from_key: string;
  relation: string;
  source: "auto" | "manual";
  snippet: string;
}

// A linked record in a read's neighbourhood (outbound child or inbound backlink).
export interface Neighbour {
  namespace: string;
  key: string;
  relation: string;
  snippet: string;
}

// A read returns the record plus its immediate neighbourhood, so navigating a
// hub-note (read it, see its children) is one call instead of N follow-up reads.
export interface ReadResult extends Memory {
  children: Neighbour[];
  backlinks: Neighbour[];
}

const DUP_BM25_MAX = 0;
// Depth-1 cap on each side of a read's neighbourhood — bound the payload so a
// high-degree hub doesn't dump every child.
const NEIGHBOUR_CAP = 20;
// Above this word count a non-'reference' memory gets a non-blocking nudge to
// stay atomic. A length check, not an LLM call — atomic notes are the default;
// 'reference' is the explicit longform escape hatch.
const SIZE_WARN_WORDS = 200;

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

// First non-empty line of a memory, trimmed and capped. For an atomic note this
// line is effectively the summary, which is why no stored LLM summary is needed.
function snippet(content: string): string {
  const line = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.trim().slice(0, 160);
}

export class MemoryStore {
  private deleteAutoLinks: Database.Statement;
  private insertLink: Database.Statement;

  constructor(private db: Database.Database) {
    this.deleteAutoLinks = this.db.prepare(`DELETE FROM links WHERE from_id = ? AND source = 'auto'`);
    this.insertLink = this.db.prepare(
      `INSERT OR IGNORE INTO links
       (from_id, to_namespace, to_key, relation, source)
       VALUES (?, ?, ?, 'wikilink', 'auto')`,
    );
  }

  // `author` is the verified token subject (or null over stdio). It is a separate
  // argument, never part of NoteInput — attribution must come from the principal
  // the Resource Server verified, not from agent-supplied tool args.
  note(input: NoteInput, author: string | null = null): NoteResult {
    const namespace = normalizeNamespace(input.namespace);
    const key = input.key ? normalizeKey(input.key) : deriveKey(input.content);
    const onConflict: OnConflict = input.on_conflict ?? "overwrite";

    const existing = this.db
      .prepare<unknown[], MemoryRow>(
        `SELECT * FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get(namespace, key);

    if (existing && onConflict === "error") {
      throw new Error(
        `memory exists at namespace='${namespace}' key='${key}'. Pass on_conflict='overwrite' or 'append'.`,
      );
    }

    const dup = this.findNearDuplicates(
      namespace,
      key,
      input.content,
      existing?.id ?? null,
    );

    const content =
      existing && onConflict === "append"
        ? `${existing.content}\n\n${input.content}`
        : input.content;

    const tagsForRow =
      input.tags ?? (existing ? (JSON.parse(existing.tags) as string[]) : []);
    const tagsJson = JSON.stringify(tagsForRow);
    const metadataJson = JSON.stringify(input.metadata ?? {});
    const type = input.type ?? "note";

    const upsert = this.db.transaction((): MemoryRow => {
      const row = this.db
        .prepare<unknown[], MemoryRow>(
          `INSERT INTO memories (namespace, key, type, content, tags, metadata, source, created_by, updated_by)
           VALUES (@namespace, @key, @type, @content, @tags, @metadata, @source, @author, @author)
           ON CONFLICT(namespace, key) DO UPDATE SET
             type        = excluded.type,
             content     = excluded.content,
             tags        = excluded.tags,
             metadata    = excluded.metadata,
             source      = excluded.source,
             updated_by  = excluded.updated_by,
             updated_at  = datetime('now'),
             accessed_at = datetime('now')
           RETURNING *`,
        )
        .get({
          namespace,
          key,
          type,
          content,
          tags: tagsJson,
          metadata: metadataJson,
          source: input.source ?? null,
          author,
        });
      if (!row) throw new Error("note: upsert failed");
      if (input.tags !== undefined) this.applyTags(row.id, input.tags);
      this.applyAutoLinks(row.id, namespace, content);
      return row;
    });

    const row = upsert();
    const result: NoteResult = rowToMemory(row);
    if (dup.length) result.near_duplicate_warning = dup;
    if (type !== "reference" && wordCount(content) > SIZE_WARN_WORDS) {
      result.size_warning =
        `This memory is ${wordCount(content)} words. Memories are best kept atomic — ` +
        `consider splitting into linked [[notes]], or use type:'reference' for durable longform.`;
    }
    return result;
  }

  private applyTags(memoryId: number, tags: string[]): void {
    this.db.prepare(`DELETE FROM tags WHERE memory_id = ?`).run(memoryId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO tags (memory_id, tag) VALUES (?, ?)`,
    );
    for (const tag of tags) insert.run(memoryId, tag);
  }

  private applyAutoLinks(
    memoryId: number,
    sourceNamespace: string,
    content: string,
  ): void {
    this.deleteAutoLinks.run(memoryId);
    const refs = parseWikilinks(content, sourceNamespace);
    for (const r of refs) {
      this.insertLink.run(memoryId, normalizeNamespace(r.namespace), normalizeKey(r.key));
    }
  }

  private findNearDuplicates(
    namespace: string,
    key: string,
    content: string,
    excludeId: number | null,
  ): NearDuplicate[] {
    const term = content.slice(0, 200).replace(/[^\w\s]+/g, " ").trim();
    if (!term) return [];
    const rows = this.db
      .prepare<
        unknown[],
        { namespace: string; key: string; rank: number; content: string }
      >(
        `SELECT m.namespace, m.key, m.content, bm25(memories_fts) AS rank
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE memories_fts MATCH @q
           AND NOT (m.namespace = @ns AND m.key = @k)
           AND (@excludeId IS NULL OR m.id != @excludeId)
         ORDER BY rank
         LIMIT 3`,
      )
      .all({
        q: this.ftsQuery(term),
        ns: namespace,
        k: key,
        excludeId,
      });
    return rows
      .filter((r) => r.rank < DUP_BM25_MAX)
      .map((r) => ({
        namespace: r.namespace,
        key: r.key,
        score: -r.rank,
        snippet: snippet(r.content),
      }));
  }

  private ftsQuery(raw: string): string {
    return raw
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8)
      .map((w) => `"${w.replace(/"/g, "")}"`)
      .join(" OR ") || `"${raw}"`;
  }

  read(namespace: string, key: string): ReadResult | null {
    namespace = normalizeNamespace(namespace);
    key = normalizeKey(key);
    const row = this.db
      .prepare<unknown[], MemoryRow>(
        `UPDATE memories SET accessed_at = datetime('now')
         WHERE namespace = ? AND key = ?
         RETURNING *`,
      )
      .get(namespace, key);
    if (!row) return null;
    return {
      ...rowToMemory(row),
      children: this.outboundNeighbours(row.id),
      backlinks: this.inboundNeighbours(namespace, key),
    };
  }

  // Outbound links to *existing* records (dangling targets are omitted — they
  // aren't records, so they carry no snippet).
  private outboundNeighbours(fromId: number): Neighbour[] {
    const rows = this.db
      .prepare<unknown[], Omit<Neighbour, "snippet"> & { content: string }>(
        `SELECT l.to_namespace AS namespace, l.to_key AS key, l.relation, m.content
         FROM links l
         JOIN memories m ON m.namespace = l.to_namespace AND m.key = l.to_key
         WHERE l.from_id = @fromId
         ORDER BY m.updated_at DESC
         LIMIT @limit`,
      )
      .all({ fromId, limit: NEIGHBOUR_CAP });
    return rows.map(({ content, ...n }) => ({ ...n, snippet: snippet(content) }));
  }

  private inboundNeighbours(namespace: string, key: string): Neighbour[] {
    const rows = this.db
      .prepare<unknown[], Omit<Neighbour, "snippet"> & { content: string }>(
        `SELECT m.namespace, m.key, l.relation, m.content
         FROM links l
         JOIN memories m ON m.id = l.from_id
         WHERE l.to_namespace = @ns AND l.to_key = @key
         ORDER BY m.updated_at DESC
         LIMIT @limit`,
      )
      .all({ ns: namespace, key, limit: NEIGHBOUR_CAP });
    return rows.map(({ content, ...n }) => ({ ...n, snippet: snippet(content) }));
  }

  recall(input: RecallInput): Memory[] {
    const where: string[] = ["memories_fts MATCH @query"];
    const params: Record<string, unknown> = { query: input.query };
    if (input.namespace) {
      where.push("m.namespace = @namespace");
      params.namespace = normalizeNamespace(input.namespace);
    }
    if (input.type) {
      where.push("m.type = @type");
      params.type = input.type;
    }
    if (input.since) {
      where.push("m.updated_at >= @since");
      params.since = input.since;
    }
    for (const [i, tag] of (input.tags ?? []).entries()) {
      const p = `tag${i}`;
      where.push(`EXISTS (SELECT 1 FROM tags t WHERE t.memory_id = m.id AND t.tag = @${p})`);
      params[p] = tag;
    }
    params.limit = input.limit ?? 5;
    const rows = this.db
      .prepare<unknown[], MemoryRow & { has_inbound: 0 | 1 }>(
        `SELECT m.*,
                EXISTS (SELECT 1 FROM links l
                         WHERE l.to_namespace = m.namespace
                           AND l.to_key = m.key) AS has_inbound
         FROM memories_fts
         JOIN memories m ON m.id = memories_fts.rowid
         WHERE ${where.join(" AND ")}
         ORDER BY has_inbound DESC, bm25(memories_fts)
         LIMIT @limit`,
      )
      .all(params);
    return rows.map(rowToMemory);
  }

  browse(input: BrowseInput): BrowseResult {
    const limit = input.limit ?? 20;
    const ns = input.namespace ? normalizeNamespace(input.namespace) : undefined;
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM memories`).get() as { c: number }
    ).c;
    switch (input.kind) {
      case "recent":
        return {
          kind: "recent",
          total,
          items: this.recent(limit, ns, input.prefix),
        };
      case "hubs":
        return { kind: "hubs", total, items: this.hubs(limit, ns) };
      case "orphans":
        return {
          kind: "orphans",
          total,
          items: this.orphans(limit, ns),
        };
      case "tags":
        return { kind: "tags", total, items: this.tagVocabulary(input.prefix, limit) };
      case "tagged":
        return {
          kind: "tagged",
          total,
          items: input.tag ? this.tagged(input.tag, limit) : [],
        };
      case "namespaces":
        return {
          kind: "namespaces",
          total,
          items: this.namespaceVocabulary(input.prefix, limit),
        };
      case "index":
      default: {
        const sections: IndexSection[] = [
          {
            section: "recent",
            items: this.recent(5, ns, input.prefix),
          },
          { section: "tags", items: this.tagVocabulary(input.prefix, 10) },
          { section: "namespaces", items: this.namespaceVocabulary(input.prefix, 10) },
        ];
        return { kind: "index", total, items: sections };
      }
    }
  }

  private recent(limit: number, namespace?: string, prefix?: string): RecentItem[] {
    const where: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (namespace) {
      where.push("namespace = @namespace");
      params.namespace = namespace;
    }
    if (prefix) {
      where.push("key LIKE @prefix");
      params.prefix = `${prefix}%`;
    }
    const sql =
      `SELECT namespace, key, type, updated_at, content FROM memories` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY updated_at DESC LIMIT @limit`;
    const rows = this.db
      .prepare<unknown[], Omit<RecentItem, "snippet"> & { content: string }>(sql)
      .all(params);
    return rows.map(({ content, ...item }) => ({ ...item, snippet: snippet(content) }));
  }

  private hubs(limit: number, namespace?: string): HubItem[] {
    const where = namespace ? "WHERE m.namespace = @namespace" : "";
    const params: Record<string, unknown> = { limit };
    if (namespace) params.namespace = namespace;
    const rows = this.db
      .prepare<unknown[], Omit<HubItem, "snippet"> & { content: string }>(
        `SELECT m.namespace, m.key, m.type, m.updated_at, m.content,
                COALESCE(agg.in_degree, 0) AS in_degree
         FROM memories m
         LEFT JOIN (
           SELECT to_namespace, to_key, COUNT(*) AS in_degree
           FROM links
           GROUP BY to_namespace, to_key
         ) agg
           ON agg.to_namespace = m.namespace AND agg.to_key = m.key
         ${where}
         ORDER BY in_degree DESC, m.updated_at DESC
         LIMIT @limit`,
      )
      .all(params);
    return rows.map(({ content, ...item }) => ({ ...item, snippet: snippet(content) }));
  }

  private orphans(limit: number, namespace?: string): OrphanItem[] {
    const where = namespace ? "AND m.namespace = @namespace" : "";
    const params: Record<string, unknown> = { limit };
    if (namespace) params.namespace = namespace;
    const rows = this.db
      .prepare<unknown[], Omit<OrphanItem, "snippet"> & { content: string }>(
        `SELECT m.namespace, m.key, m.type, m.updated_at, m.content FROM memories m
         WHERE NOT EXISTS (SELECT 1 FROM links lo WHERE lo.from_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM links li
                            WHERE li.to_namespace = m.namespace
                              AND li.to_key = m.key)
           ${where}
         ORDER BY m.updated_at DESC
         LIMIT @limit`,
      )
      .all(params);
    return rows.map(({ content, ...item }) => ({ ...item, snippet: snippet(content) }));
  }

  private tagVocabulary(prefix: string | undefined, limit: number): TagItem[] {
    const where = prefix ? "WHERE tag LIKE @prefix" : "";
    const params: Record<string, unknown> = { limit };
    if (prefix) params.prefix = `${prefix}%`;
    return this.db
      .prepare<unknown[], TagItem>(
        `SELECT tag, COUNT(*) AS count FROM tags
         ${where}
         GROUP BY tag
         ORDER BY count DESC, tag ASC
         LIMIT @limit`,
      )
      .all(params);
  }

  // List the memories carrying a given tag, newest first. The tag *vocabulary* lives in
  // tagVocabulary (kind=tags); this is the drill-in: pick a tag, see its memories. Records, so
  // it carries a snippet (ADR 0002), matching recent/hubs/orphans.
  private tagged(tag: string, limit: number): RecentItem[] {
    const rows = this.db
      .prepare<unknown[], Omit<RecentItem, "snippet"> & { content: string }>(
        `SELECT m.namespace, m.key, m.type, m.updated_at, m.content FROM memories m
         WHERE EXISTS (SELECT 1 FROM tags t WHERE t.memory_id = m.id AND t.tag = @tag)
         ORDER BY m.updated_at DESC, m.id DESC
         LIMIT @limit`,
      )
      .all({ tag, limit });
    return rows.map(({ content, ...item }) => ({ ...item, snippet: snippet(content) }));
  }

  // The one sanctioned identifier-only view alongside tags: an explicit
  // "show me the namespaces" structural query. `prefix` filters namespaces
  // (e.g. 'voice:' lists every voice:* scope).
  private namespaceVocabulary(
    prefix: string | undefined,
    limit: number,
  ): NamespaceItem[] {
    const where = prefix ? "WHERE namespace LIKE @prefix" : "";
    const params: Record<string, unknown> = { limit };
    if (prefix) params.prefix = `${prefix}%`;
    return this.db
      .prepare<unknown[], NamespaceItem>(
        `SELECT namespace, COUNT(*) AS count FROM memories
         ${where}
         GROUP BY namespace
         ORDER BY count DESC, namespace ASC
         LIMIT @limit`,
      )
      .all(params);
  }

  del(namespace: string, key: string, force = false): boolean {
    namespace = normalizeNamespace(namespace);
    key = normalizeKey(key);
    const row = this.db
      .prepare<unknown[], { id: number }>(
        `SELECT id FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get(namespace, key);
    if (!row) return false;
    const backlinkCount = (
      this.db
        .prepare<unknown[], { c: number }>(
          `SELECT COUNT(*) AS c FROM links WHERE to_namespace = ? AND to_key = ?`,
        )
        .get(namespace, key) as { c: number }
    ).c;
    if (backlinkCount > 0 && !force) {
      throw new Error(
        `cannot delete ${namespace}/${key}: ${backlinkCount} backlinks exist. Pass force=true to delete anyway.`,
      );
    }
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(row.id);
    return true;
  }

  link(
    fromNamespace: string,
    fromKey: string,
    toNamespace: string,
    toKey: string,
    relation = "related",
  ): boolean {
    fromNamespace = normalizeNamespace(fromNamespace);
    fromKey = normalizeKey(fromKey);
    toNamespace = normalizeNamespace(toNamespace);
    toKey = normalizeKey(toKey);
    const from = this.db
      .prepare<unknown[], { id: number }>(
        `SELECT id FROM memories WHERE namespace = ? AND key = ?`,
      )
      .get(fromNamespace, fromKey);
    if (!from) {
      throw new Error(`no memory at ${fromNamespace}/${fromKey} to link from`);
    }
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO links
         (from_id, to_namespace, to_key, relation, source)
         VALUES (?, ?, ?, ?, 'manual')`,
      )
      .run(from.id, toNamespace, toKey, relation);
    return info.changes > 0;
  }

  backlinks(namespace: string, key: string): Backlink[] {
    namespace = normalizeNamespace(namespace);
    key = normalizeKey(key);
    const rows = this.db
      .prepare<unknown[], Omit<Backlink, "snippet"> & { content: string }>(
        `SELECT m.namespace AS from_namespace,
                m.key       AS from_key,
                l.relation,
                l.source,
                m.content
         FROM links l
         JOIN memories m ON m.id = l.from_id
         WHERE l.to_namespace = ? AND l.to_key = ?
         ORDER BY m.updated_at DESC`,
      )
      .all(namespace, key);
    return rows.map(({ content, ...rest }) => ({ ...rest, snippet: snippet(content) }));
  }
}
