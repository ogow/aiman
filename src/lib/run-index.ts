import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import { getProjectPaths } from "./paths.js";
import type {
   LaunchMode,
   PersistedRunRecord,
   ProfileScope,
   ProviderId,
   RunMode,
   RunStatus,
   StoredRunState
} from "./types.js";

type IndexedRunRecord = {
   cwd: string;
   endedAt?: string;
   heartbeatAt?: string;
   launchMode: LaunchMode;
   mode: RunMode;
   pid?: number;
   profile: string;
   profilePath: string;
   profileScope: ProfileScope;
   projectRoot: string;
   provider: ProviderId;
   runDir: string;
   runId: string;
   startedAt: string;
   status: RunStatus | "running";
};

type RunIndexStatement = {
   all(...params: unknown[]): unknown;
   get(...params: unknown[]): unknown;
   run(...params: unknown[]): unknown;
};

type RunIndexDatabase = {
   close(): void;
   exec(sql: string): unknown;
   prepare(sql: string): RunIndexStatement;
};

let databaseLocation: string | undefined;
let databasePromise: Promise<RunIndexDatabase> | undefined;

function isSqliteExperimentalWarning(
   warning: string | Error,
   type: string | undefined
): boolean {
   const message = typeof warning === "string" ? warning : warning.message;
   const warningType =
      typeof type === "string"
         ? type
         : warning instanceof Error
           ? warning.name
           : undefined;

   return (
      warningType === "ExperimentalWarning" &&
      message.includes("SQLite is an experimental feature")
   );
}

async function openNodeSqliteDatabase(
   dbPath: string
): Promise<RunIndexDatabase> {
   const sqliteModule = await import("node:sqlite");
   return new sqliteModule.DatabaseSync(dbPath);
}

async function openBunSqliteDatabase(
   dbPath: string
): Promise<RunIndexDatabase> {
   const sqliteModule = await import("bun:sqlite");
   return new sqliteModule.Database(dbPath);
}

async function loadDatabase(dbPath: string): Promise<RunIndexDatabase> {
   await mkdir(path.dirname(dbPath), { recursive: true });

   const originalEmitWarning = process.emitWarning.bind(process);
   process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      const type = typeof args[0] === "string" ? args[0] : undefined;

      if (isSqliteExperimentalWarning(warning, type)) {
         return;
      }

      return originalEmitWarning(
         warning as never,
         ...(args as Parameters<typeof process.emitWarning> extends [
            unknown,
            ...infer Rest
         ]
            ? Rest
            : never[])
      );
   }) as typeof process.emitWarning;

   try {
      let db: RunIndexDatabase;

      try {
         db = await openNodeSqliteDatabase(dbPath);
      } catch {
         db = await openBunSqliteDatabase(dbPath);
      }

      db.exec(`
         PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 1000;
         CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            project_root TEXT NOT NULL,
            agent TEXT NOT NULL,
            agent_path TEXT NOT NULL,
            agent_scope TEXT NOT NULL,
            provider TEXT NOT NULL,
            mode TEXT NOT NULL,
            launch_mode TEXT NOT NULL,
            status TEXT NOT NULL,
            pid INTEGER,
            heartbeat_at TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            cwd TEXT NOT NULL,
            run_dir TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_runs_started_at
            ON runs (started_at DESC, run_id DESC);
         CREATE INDEX IF NOT EXISTS idx_runs_project_started_at
            ON runs (project_root, started_at DESC, run_id DESC);
      `);

      return db;
   } finally {
      process.emitWarning = originalEmitWarning;
   }
}

async function openRunDatabase(): Promise<RunIndexDatabase> {
   const { runDbPath } = getProjectPaths();

   if (databaseLocation !== runDbPath) {
      const previousPromise = databasePromise;

      databaseLocation = runDbPath;
      databasePromise = loadDatabase(runDbPath);

      if (previousPromise !== undefined) {
         void previousPromise.then((db) => {
            db.close();
         });
      }
   }

   return databasePromise!;
}

function toIndexedRunRecord(
   record: PersistedRunRecord | StoredRunState
): IndexedRunRecord {
   return {
      cwd: record.cwd,
      ...("endedAt" in record && typeof record.endedAt === "string"
         ? { endedAt: record.endedAt }
         : {}),
      ...("heartbeatAt" in record && typeof record.heartbeatAt === "string"
         ? { heartbeatAt: record.heartbeatAt }
         : {}),
      launchMode: record.launchMode,
      mode: record.mode,
      ...("pid" in record && typeof record.pid === "number"
         ? { pid: record.pid }
         : {}),
      profile: record.profile ?? record.agent ?? "",
      profilePath: record.profilePath ?? record.agentPath ?? "",
      profileScope:
         record.profileScope ??
         record.agentScope ??
         ("project" as ProfileScope),
      projectRoot: record.projectRoot,
      provider: record.provider,
      runDir: record.paths.runDir,
      runId: record.runId,
      startedAt: record.startedAt,
      status: record.status
   };
}

export type RunIndexEntry = IndexedRunRecord;

export async function upsertRunIndexEntry(
   record: PersistedRunRecord | StoredRunState
): Promise<void> {
   const db = await openRunDatabase();
   const entry = toIndexedRunRecord(record);

   db.prepare(
      `
         INSERT INTO runs (
            run_id,
            project_root,
            agent,
            agent_path,
            agent_scope,
            provider,
            mode,
            launch_mode,
            status,
            pid,
            heartbeat_at,
            started_at,
            ended_at,
            cwd,
            run_dir
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
            project_root = excluded.project_root,
            agent = excluded.agent,
            agent_path = excluded.agent_path,
            agent_scope = excluded.agent_scope,
            provider = excluded.provider,
            mode = excluded.mode,
            launch_mode = excluded.launch_mode,
            status = excluded.status,
            pid = excluded.pid,
            heartbeat_at = excluded.heartbeat_at,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            cwd = excluded.cwd,
            run_dir = excluded.run_dir
      `
   ).run(
      entry.runId,
      entry.projectRoot,
      entry.profile,
      entry.profilePath,
      entry.profileScope,
      entry.provider,
      entry.mode,
      entry.launchMode,
      entry.status,
      entry.pid ?? null,
      entry.heartbeatAt ?? null,
      entry.startedAt,
      entry.endedAt ?? null,
      entry.cwd,
      entry.runDir
   );
}

export async function readRunIndexEntry(
   runId: string
): Promise<RunIndexEntry | undefined> {
   const db = await openRunDatabase();
   const row = db
      .prepare(
         `
            SELECT
               run_id,
               project_root,
               agent,
               agent_path,
               agent_scope,
               provider,
               mode,
               launch_mode,
               status,
               pid,
               heartbeat_at,
               started_at,
               ended_at,
               cwd,
               run_dir
            FROM runs
            WHERE run_id = ?
         `
      )
      .get(runId) as
      | {
           agent: string;
           agent_path: string;
           agent_scope: ProfileScope;
           cwd: string;
           ended_at: string | null;
           heartbeat_at: string | null;
           launch_mode: LaunchMode;
           mode: RunMode;
           pid: number | null;
           project_root: string;
           provider: ProviderId;
           run_dir: string;
           run_id: string;
           started_at: string;
           status: RunStatus | "running";
        }
      | undefined;

   if (row === undefined) {
      return undefined;
   }

   return {
      cwd: row.cwd,
      ...(typeof row.ended_at === "string" ? { endedAt: row.ended_at } : {}),
      ...(typeof row.heartbeat_at === "string"
         ? { heartbeatAt: row.heartbeat_at }
         : {}),
      launchMode: row.launch_mode,
      mode: row.mode,
      ...(typeof row.pid === "number" ? { pid: row.pid } : {}),
      profile: row.agent,
      profilePath: row.agent_path,
      profileScope: row.agent_scope,
      projectRoot: row.project_root,
      provider: row.provider,
      runDir: row.run_dir,
      runId: row.run_id,
      startedAt: row.started_at,
      status: row.status
   };
}

export async function listRunIndexEntries(): Promise<RunIndexEntry[]> {
   const db = await openRunDatabase();
   const rows = db
      .prepare(
         `
            SELECT
               run_id,
               project_root,
               agent,
               agent_path,
               agent_scope,
               provider,
               mode,
               launch_mode,
               status,
               pid,
               heartbeat_at,
               started_at,
               ended_at,
               cwd,
               run_dir
            FROM runs
            ORDER BY started_at DESC, run_id DESC
         `
      )
      .all() as Array<{
      agent: string;
      agent_path: string;
      agent_scope: ProfileScope;
      cwd: string;
      ended_at: string | null;
      heartbeat_at: string | null;
      launch_mode: LaunchMode;
      mode: RunMode;
      pid: number | null;
      project_root: string;
      provider: ProviderId;
      run_dir: string;
      run_id: string;
      started_at: string;
      status: RunStatus | "running";
   }>;

   return rows.map((row) => ({
      cwd: row.cwd,
      ...(typeof row.ended_at === "string" ? { endedAt: row.ended_at } : {}),
      ...(typeof row.heartbeat_at === "string"
         ? { heartbeatAt: row.heartbeat_at }
         : {}),
      launchMode: row.launch_mode,
      mode: row.mode,
      ...(typeof row.pid === "number" ? { pid: row.pid } : {}),
      profile: row.agent,
      profilePath: row.agent_path,
      profileScope: row.agent_scope,
      projectRoot: row.project_root,
      provider: row.provider,
      runDir: row.run_dir,
      runId: row.run_id,
      startedAt: row.started_at,
      status: row.status
   }));
}
