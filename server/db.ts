import fs from 'node:fs';
import path from 'node:path';
import type {
  AppNotification,
  AuditLogEntry,
  DatabaseSchema,
  OutboxMessage,
  Role,
} from '../src/shared/types';
import { createSeedDatabase } from './seed';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'foodbridge-db.json');

let dbCache: DatabaseSchema | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function persistToDisk(db: DatabaseSchema) {
  ensureDataDir();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
}

export function loadDatabase(): DatabaseSchema {
  if (dbCache) return dbCache;
  ensureDataDir();
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as DatabaseSchema;
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.donations)) {
        dbCache = parsed;
        return dbCache;
      }
    } catch (err) {
      console.error('Failed to read existing database, re-seeding:', err);
    }
  }
  const seeded = createSeedDatabase();
  dbCache = seeded;
  persistToDisk(seeded);
  return dbCache;
}

export function getDb(): DatabaseSchema {
  return loadDatabase();
}

export function saveDb(db: DatabaseSchema): void {
  dbCache = db;
  persistToDisk(db);
}

// Serialized transaction helper to enforce atomic reservations & claim locks
export function withTransaction<T>(fn: (db: DatabaseSchema) => Promise<T> | T): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = loadDatabase();
    const result = await fn(db);
    saveDb(db);
    return result;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function resetDatabase(seedDemo = true): DatabaseSchema {
  const fresh: DatabaseSchema = seedDemo
    ? createSeedDatabase()
    : {
        users: createSeedDatabase().users,
        donors: createSeedDatabase().donors,
        ngos: createSeedDatabase().ngos,
        volunteers: createSeedDatabase().volunteers,
        donations: [],
        food_safety_passports: [],
        ai_assessments: [],
        ngo_requirements: createSeedDatabase().ngo_requirements,
        match_recommendations: [],
        offers: [],
        acceptances: [],
        pickups: [],
        deliveries: [],
        certificates: [],
        notifications: [],
        outbox_messages: [],
        ratings: [],
        impact_records: [],
        audit_log: [],
        reports_issues: [],
        settings: createSeedDatabase().settings,
      };
  dbCache = fresh;
  persistToDisk(fresh);
  return fresh;
}

export function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function appendAudit(
  db: DatabaseSchema,
  entry: {
    donationId?: string;
    actorUserId: string;
    actorName: string;
    actorRole: Role | 'system';
    action: string;
    fromStatus?: string;
    toStatus?: string;
    note: string;
  }
): AuditLogEntry {
  const now = new Date().toISOString();
  const record: AuditLogEntry = {
    id: nextId('aud'),
    ...entry,
    created_at: now,
    updated_at: now,
  };
  db.audit_log.unshift(record);
  if (db.audit_log.length > 500) db.audit_log.length = 500;
  return record;
}

export function appendNotification(
  db: DatabaseSchema,
  notif: Omit<AppNotification, 'id' | 'read' | 'created_at' | 'updated_at'>
): AppNotification {
  const now = new Date().toISOString();
  const record: AppNotification = {
    id: nextId('ntf'),
    ...notif,
    read: false,
    created_at: now,
    updated_at: now,
  };
  db.notifications.unshift(record);
  if (db.notifications.length > 300) db.notifications.length = 300;
  return record;
}

export function appendOutbox(
  db: DatabaseSchema,
  msg: Omit<OutboxMessage, 'id' | 'simulated' | 'created_at' | 'updated_at'>
): OutboxMessage {
  const now = new Date().toISOString();
  const record: OutboxMessage = {
    id: nextId('out'),
    ...msg,
    simulated: true,
    created_at: now,
    updated_at: now,
  };
  db.outbox_messages.unshift(record);
  if (db.outbox_messages.length > 200) db.outbox_messages.length = 200;
  return record;
}
