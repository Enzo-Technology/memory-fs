import type Database from "better-sqlite3";
import {
  type Memory,
  type MemoryRow,
  type MemoryType,
  rowToMemory,
} from "./db.js";
import { deriveKey } from "./slug.js";
import { parseWikilinks } from "./wikilinks.js";

export type OnConflict = "overwrite" | "append" | "error";
export type BrowseKind = "index" | "recent" | "hubs" | "orphans" | "tags";

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
}

export interface NoteResult extends Memory {
  near_duplicate_warning?: NearDuplicate[];
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
}

export interface RecentItem {
  namespace: string;
  key: string;
  type: MemoryType;
  updated_at: string;
}
export interface HubItem extends RecentItem {
  in_degree: number;
}
export interface OrphanItem extends RecentItem {}
export interface TagItem {
  tag: string;
  count: number;
}
export interface IndexSection {
  section: "recent" | "hubs" | "tags";
  items: RecentItem[] | HubItem[] | TagItem[];
}

export type BrowseResult =
  | { kind: "index"; total: number; items: IndexSection[] }
  | { kind: "recent"; total: number; items: RecentItem[] }
  | { kind: "hubs"; total: number; items: HubItem[] }
  | { kind: "orphans"; total: number; items: OrphanItem[] }
  | { kind: "tags"; total: number; items: TagItem[] };

export interface Backlink {
  from_namespace: string;
  from_key: string;
  relation: string;
  source: "auto" | "manual";
}

const DUP_SIM_THRESHOLD = 0;

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

  note(input: NoteInput): NoteResult {
    const namespace = input.namespace;
    const key = input.key ?? deriveKey(input.content);
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
          `INSERT INTO memories (namespace, key, type, content, tags, metadata, source)
           VALUES (@namespace, @key, @type, @content, @tags, @metadata, @source)
           ON CONFLICT(namespace, key) DO UPDATE SET
             type        = excluded.type,
             content     = excluded.content,
             tags        = excluded.tags,
             metadata    = excluded.metadata,
             source      = excluded.source,
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
        });
      if (!row) throw new Error("note: upsert failed");
      if (input.tags !== undefined) this.applyTags(row.id, input.tags);
      this.applyAutoLinks(row.id, namespace, content);
      return row;
    });

    const row = upsert();
    const result: NoteResult = rowToMemory(row);
    if (dup.length) result.near_duplicate_warning = dup;
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
    for (const r of refs) this.insertLink.run(memoryId, r.namespace, r.key);
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
        { namespace: string; key: string; rank: number }
      >(
        `SELECT m.namespace, m.key, bm25(memories_fts) AS rank
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
      .filter((r) => r.rank < DUP_SIM_THRESHOLD)
      .map((r) => ({ namespace: r.namespace, key: r.key, score: -r.rank }));
  }

  private ftsQuery(raw: string): string {
    return raw
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 8)
      .map((w) => `"${w.replace(/"/g, "")}"`)
      .join(" OR ") || `"${raw}"`;
  }

  read(namespace: string, key: string): Memory | null {
    const row = this.db
      .prepare<unknown[], MemoryRow>(
        `UPDATE memories SET accessed_at = datetime('now')
         WHERE namespace = ? AND key = ?
         RETURNING *`,
      )
      .get(namespace, key);
    return row ? rowToMemory(row) : null;
  }

  recall(input: RecallInput): Memory[] {
    const where: string[] = ["memories_fts MATCH @query"];
    const params: Record<string, unknown> = { query: input.query };
    if (input.namespace) {
      where.push("m.namespace = @namespace");
      params.namespace = input.namespace;
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
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM memories`).get() as { c: number }
    ).c;
    switch (input.kind) {
      case "recent":
        return {
          kind: "recent",
          total,
          items: this.recent(limit, input.namespace, input.prefix),
        };
      case "hubs":
        return { kind: "hubs", total, items: this.hubs(limit, input.namespace) };
      case "orphans":
        return {
          kind: "orphans",
          total,
          items: this.orphans(limit, input.namespace),
        };
      case "tags":
        return { kind: "tags", total, items: this.tagVocabulary(input.prefix, limit) };
      case "index":
      default: {
        const sections: IndexSection[] = [
          {
            section: "recent",
            items: this.recent(5, input.namespace, input.prefix),
          },
          { section: "hubs", items: this.hubs(5, input.namespace) },
          { section: "tags", items: this.tagVocabulary(input.prefix, 10) },
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
      `SELECT namespace, key, type, updated_at FROM memories` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY updated_at DESC LIMIT @limit`;
    return this.db.prepare<unknown[], RecentItem>(sql).all(params);
  }

  private hubs(limit: number, namespace?: string): HubItem[] {
    const where = namespace ? "WHERE m.namespace = @namespace" : "";
    const params: Record<string, unknown> = { limit };
    if (namespace) params.namespace = namespace;
    return this.db
      .prepare<unknown[], HubItem>(
        `SELECT m.namespace, m.key, m.type, m.updated_at,
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
  }

  private orphans(limit: number, namespace?: string): OrphanItem[] {
    const where = namespace ? "AND m.namespace = @namespace" : "";
    const params: Record<string, unknown> = { limit };
    if (namespace) params.namespace = namespace;
    return this.db
      .prepare<unknown[], OrphanItem>(
        `SELECT m.namespace, m.key, m.type, m.updated_at FROM memories m
         WHERE NOT EXISTS (SELECT 1 FROM links lo WHERE lo.from_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM links li
                            WHERE li.to_namespace = m.namespace
                              AND li.to_key = m.key)
           ${where}
         ORDER BY m.updated_at DESC
         LIMIT @limit`,
      )
      .all(params);
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

  del(namespace: string, key: string, force = false): boolean {
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
    return this.db
      .prepare<unknown[], Backlink>(
        `SELECT m.namespace AS from_namespace,
                m.key       AS from_key,
                l.relation,
                l.source
         FROM links l
         JOIN memories m ON m.id = l.from_id
         WHERE l.to_namespace = ? AND l.to_key = ?
         ORDER BY m.updated_at DESC`,
      )
      .all(namespace, key);
  }
}
