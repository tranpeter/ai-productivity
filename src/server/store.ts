import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  configSchema,
  defaultConfig,
  recordSchema,
  type Config,
  type RecordData,
  type Report,
} from "../shared/contracts.js";
export class Store {
  db: DatabaseSync;
  constructor(public path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version > 1) {
      this.db.close();
      throw new Error("Database schema is newer than this application");
    }
    if (version < 1) {
      if (path !== ":memory:" && existsSync(path)) {
        const backup = path + ".pre-v1-" + Date.now();
        this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      }
      this.transaction(() =>
        this.db.exec(
          `CREATE TABLE config(revision INTEGER PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE records(source TEXT,id TEXT,kind TEXT,hash TEXT,payload TEXT,PRIMARY KEY(source,id,kind));CREATE TABLE versions(source TEXT,id TEXT,kind TEXT,hash TEXT,payload TEXT,retrieved TEXT,PRIMARY KEY(source,id,kind,hash));CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE reports(id TEXT PRIMARY KEY,payload TEXT NOT NULL);PRAGMA user_version=1;`,
        ),
      );
    }
    if (!this.db.prepare("SELECT revision FROM config LIMIT 1").get())
      this.db
        .prepare("INSERT INTO config VALUES(?,?)")
        .run(0, JSON.stringify(defaultConfig));
    for (const job of this.jobs()) {
      if (["running", "queued"].includes(job.status)) {
        job.status = "interrupted";
        this.saveJob(job);
      }
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  config(): Config {
    return JSON.parse(
      (
        this.db
          .prepare("SELECT payload FROM config ORDER BY revision DESC LIMIT 1")
          .get() as { payload: string }
      ).payload,
    );
  }
  saveConfig(input: unknown): Config {
    const c = configSchema.parse(input);
    return this.transaction(() => {
      if (c.revision !== this.config().revision)
        throw new Error("CONFIG_CONFLICT");
      const next = { ...c, revision: c.revision + 1 };
      this.db
        .prepare("INSERT INTO config VALUES(?,?)")
        .run(next.revision, JSON.stringify(next));
      return next;
    });
  }
  upsert(records: unknown[], job?: Job) {
    this.transaction(() => {
      for (const item of records) {
        const r = recordSchema.parse(item),
          payload = JSON.stringify(r),
          entityId = r.kind === "pr" ? r.repository + "#" + r.id : r.id,
          hash = createHash("sha256").update(payload).digest("hex");
        this.db
          .prepare("INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?,?)")
          .run(
            r.sourceId,
            entityId,
            r.kind,
            hash,
            payload,
            new Date().toISOString(),
          );
        this.db
          .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?)")
          .run(r.sourceId, entityId, r.kind, hash, payload);
      }
      if (job) this.saveJob(job);
    });
  }
  records(): RecordData[] {
    return (
      this.db.prepare("SELECT payload FROM records").all() as {
        payload: string;
      }[]
    ).map((x) => JSON.parse(x.payload));
  }
  saveReport(report: Report) {
    this.db
      .prepare("INSERT INTO reports VALUES(?,?)")
      .run(report.id, JSON.stringify(report));
  }
  report(id: string): Report | undefined {
    const r = this.db
      .prepare("SELECT payload FROM reports WHERE id=?")
      .get(id) as { payload: string } | undefined;
    return r ? JSON.parse(r.payload) : undefined;
  }
  reports() {
    return (
      this.db
        .prepare("SELECT payload FROM reports ORDER BY rowid DESC")
        .all() as { payload: string }[]
    ).map((x) => {
      const r: Report = JSON.parse(x.payload);
      return {
        id: r.id,
        created: r.created,
        label: r.current.period.label,
        synthetic: r.synthetic,
      };
    });
  }
  saveJob(j: Job) {
    this.db
      .prepare("INSERT OR REPLACE INTO jobs VALUES(?,?)")
      .run(j.id, JSON.stringify(j));
  }
  jobs(): Job[] {
    return (
      this.db.prepare("SELECT payload FROM jobs ORDER BY rowid DESC").all() as {
        payload: string;
      }[]
    ).map((x) => JSON.parse(x.payload));
  }
  job(id: string) {
    return this.jobs().find((j) => j.id === id);
  }
  close() {
    this.db.close();
  }
}
export type Job = {
  id: string;
  status: string;
  sourceIds: string[];
  mode: string;
  pages: number;
  entities: number;
  cursor: Record<string, number>;
  errors: string[];
  started: string;
  finished?: string;
  config: Config;
};
export function newJob(config: Config, sourceIds: string[], mode: string): Job {
  return {
    id: randomUUID(),
    status: "queued",
    sourceIds,
    mode,
    pages: 0,
    entities: 0,
    cursor: {},
    errors: [],
    started: new Date().toISOString(),
    config,
  };
}
