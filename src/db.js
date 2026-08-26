import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDatabase(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      public_token TEXT NOT NULL UNIQUE,
      upload_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      UNIQUE(activity_id, name)
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      normalized_identity TEXT NOT NULL,
      registration_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      UNIQUE(activity_id, normalized_identity)
    );
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('image','video')),
      size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','pending','rejected')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      device_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(media_id, device_key)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      nickname TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      contact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS danmaku (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      nickname TEXT NOT NULL,
      content TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#ffffff',
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden'))
    );
  `);

  const activity = db.prepare('SELECT id FROM activities LIMIT 1').get();
  if (!activity) {
    db.prepare('INSERT INTO activities (name, description, created_at) VALUES (?, ?, ?)')
      .run('2026届应届生集训', '集训照片与视频记录平台', new Date().toISOString());
  }
  return db;
}

export function seedDemoTeam(db, randomToken) {
  const activity = db.prepare('SELECT * FROM activities ORDER BY id LIMIT 1').get();
  const names = ['五连', '一连', '二连', '三连', '四连', '六连', '七连', '八连', '九连', '十连', '十一连', '十二连', '十三连', '十四连', '十五连', '十六连'];
  const find = db.prepare('SELECT id FROM teams WHERE activity_id = ? AND name = ?');
  const insert = db.prepare('INSERT INTO teams (activity_id, name, public_token, upload_token, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const name of names) if (!find.get(activity.id, name)) insert.run(activity.id, name, randomToken(), randomToken(), new Date().toISOString());
}
