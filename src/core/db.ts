import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

export type MemoryType = "user" | "feedback" | "project" | "reference" | "note";

export interface Memory {
  id: number;
  namespace: string;
  key: string;
  type: MemoryType;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  source: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string;
}

export interface MemoryRow {
  id: number;
  namespace: string;
  key: string;
  type: MemoryType;
  content: string;
  tags: string;
  metadata: string;
  source: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string;
}

const DEFAULT_DB_PATH =
  process.env.MEMORY_FS_DB ?? `${homedir()}/.memory-fs/memory.db`;

export function openDb(path = DEFAULT_DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace   TEXT NOT NULL,
      key         TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('user','feedback','project','reference','note')),
      content     TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      metadata    TEXT NOT NULL DEFAULT '{}',
      source      TEXT,
      created_by  TEXT,
      updated_by  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (namespace, key)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
    CREATE INDEX IF NOT EXISTS idx_memories_type      ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_updated   ON memories(updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      key,
      content,
      tags,
      content='memories',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, key, content, tags)
      VALUES (new.id, new.key, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, content, tags)
      VALUES('delete', old.id, old.key, old.content, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, content, tags)
      VALUES('delete', old.id, old.key, old.content, old.tags);
      INSERT INTO memories_fts(rowid, key, content, tags)
      VALUES (new.id, new.key, new.content, new.tags);
    END;

    CREATE TABLE IF NOT EXISTS links (
      from_id        INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_namespace   TEXT NOT NULL,
      to_key         TEXT NOT NULL,
      relation       TEXT NOT NULL DEFAULT 'wikilink',
      source         TEXT NOT NULL DEFAULT 'auto'
                     CHECK (source IN ('auto', 'manual')),
      PRIMARY KEY (from_id, to_namespace, to_key, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_links_target ON links(to_namespace, to_key);

    CREATE TABLE IF NOT EXISTS tags (
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag       TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
  `);

  // Additive migration for stores created before attribution columns existed.
  // CREATE TABLE IF NOT EXISTS above only covers fresh DBs; existing rows need
  // ADD COLUMN. Idempotent: skipped once the column is present.
  addColumnIfMissing(db, "memories", "created_by", "TEXT");
  addColumnIfMissing(db, "memories", "updated_by", "TEXT");
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function rowToMemory(r: MemoryRow): Memory {
  return {
    ...r,
    tags: JSON.parse(r.tags) as string[],
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
  };
}
