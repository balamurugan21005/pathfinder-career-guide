const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { MongoClient } = require("mongodb");

const DEFAULT_PROFILE = { assessment: null, savedCareers: [], messages: [] };

function createSqliteStore(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT '{"assessment":null,"savedCareers":[],"messages":[]}',
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS login_attempts (
      address TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      locked_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS login_attempts_updated_idx ON login_attempts(updated_at);
    CREATE TABLE IF NOT EXISTS activities (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      label TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS activities_created_idx ON activities(created_at);
    CREATE INDEX IF NOT EXISTS activities_unread_idx ON activities(is_read, created_at);
  `);
  const statements = {
    createUser: database.prepare("INSERT INTO users (email, name, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"),
    findUser: database.prepare("SELECT email, name, salt, password_hash, profile, created_at FROM users WHERE email = ?"),
    updateProfile: database.prepare("UPDATE users SET profile = ? WHERE email = ?"),
    createSession: database.prepare("INSERT INTO sessions (token_hash, email, expires_at) VALUES (?, ?, ?)"),
    findSession: database.prepare("SELECT email, expires_at FROM sessions WHERE token_hash = ?"),
    deleteSession: database.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteExpiredSessions: database.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    getLoginAttempts: database.prepare("SELECT count, locked_until, updated_at FROM login_attempts WHERE address = ?"),
    setLoginAttempts: database.prepare("INSERT INTO login_attempts (address, count, locked_until, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until, updated_at = excluded.updated_at"),
    clearLoginAttempts: database.prepare("DELETE FROM login_attempts WHERE address = ?"),
    trimLoginAttempts: database.prepare("DELETE FROM login_attempts WHERE updated_at < ?"),
    createActivity: database.prepare("INSERT INTO activities (event_id, type, subject, label, user_email, user_name, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"),
    listActivities: database.prepare("SELECT event_id AS id, type, subject, label, user_email AS userEmail, user_name AS userName, created_at AS createdAt, is_read AS isRead FROM activities ORDER BY created_at DESC, event_id DESC LIMIT ? OFFSET ?"),
    countActivities: database.prepare("SELECT COUNT(*) AS count FROM activities"),
    countCourseSearchActivities: database.prepare("SELECT COUNT(*) AS count FROM activities WHERE type = 'course_search'"),
    countUnreadActivities: database.prepare("SELECT COUNT(*) AS count FROM activities WHERE is_read = 0"),
    markActivityRead: database.prepare("UPDATE activities SET is_read = 1 WHERE event_id = ?"),
    markAllActivitiesRead: database.prepare("UPDATE activities SET is_read = 1 WHERE is_read = 0"),
    clearActivities: database.prepare("DELETE FROM activities"),
  };

  return {
    kind: "sqlite",
    createUser: (user) => statements.createUser.run(user.email, user.name, user.salt, user.password_hash, user.created_at),
    findUser: (email) => {
      const user = statements.findUser.get(email);
      return user ? { ...user, profile: JSON.parse(user.profile) } : null;
    },
    updateProfile: (email, profile) => statements.updateProfile.run(JSON.stringify(profile), email),
    createSession: (tokenHash, email, expiresAt) => statements.createSession.run(tokenHash, email, expiresAt),
    findSession: (tokenHash) => statements.findSession.get(tokenHash),
    deleteSession: (tokenHash) => statements.deleteSession.run(tokenHash),
    deleteExpiredSessions: (now) => statements.deleteExpiredSessions.run(now),
    getLoginAttempts: (address) => statements.getLoginAttempts.get(address),
    setLoginAttempts: (address, count, lockedUntil, updatedAt) => statements.setLoginAttempts.run(address, count, lockedUntil, updatedAt),
    clearLoginAttempts: (address) => statements.clearLoginAttempts.run(address),
    trimLoginAttempts: (cutoff) => statements.trimLoginAttempts.run(cutoff),
    createActivity: (activity) => statements.createActivity.run(activity.id, activity.type, activity.subject, activity.label, activity.userEmail, activity.userName, activity.createdAt),
    listActivities: (offset, limit) => statements.listActivities.all(limit, offset).map((activity) => ({ ...activity, isRead: Boolean(activity.isRead) })),
    countActivities: () => statements.countActivities.get().count,
    countCourseSearchActivities: () => statements.countCourseSearchActivities.get().count,
    countUnreadActivities: () => statements.countUnreadActivities.get().count,
    markActivityRead: (id) => statements.markActivityRead.run(id).changes > 0,
    markAllActivitiesRead: () => statements.markAllActivitiesRead.run().changes,
    clearActivities: () => statements.clearActivities.run(),
    close: () => database.close(),
  };
}

async function createMongoStore(uri, options = {}) {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: options.mongoServerSelectionTimeoutMS || 10000,
  });
  await client.connect();
  const database = client.db(options.mongoDatabase || process.env.PATHFINDER_MONGODB_DATABASE);
  const users = database.collection("users");
  const sessions = database.collection("sessions");
  const loginAttempts = database.collection("login_attempts");
  const activities = database.collection("activities");
  try {
    await Promise.all([
      users.createIndex({ email: 1 }, { unique: true }),
      sessions.createIndex({ token_hash: 1 }, { unique: true }),
      sessions.createIndex({ expires_at: 1 }),
      loginAttempts.createIndex({ address: 1 }, { unique: true }),
      loginAttempts.createIndex({ updated_at: 1 }),
      activities.createIndex({ event_id: 1 }, { unique: true }),
      activities.createIndex({ created_at: -1 }),
      activities.createIndex({ is_read: 1, created_at: -1 }),
    ]);
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    kind: "mongodb",
    createUser: (user) => users.insertOne({ ...user, profile: DEFAULT_PROFILE }),
    findUser: (email) => users.findOne({ email }, { projection: { _id: 0 } }),
    updateProfile: (email, profile) => users.updateOne({ email }, { $set: { profile } }),
    createSession: (tokenHash, email, expiresAt) => sessions.insertOne({ token_hash: tokenHash, email, expires_at: expiresAt }),
    findSession: (tokenHash) => sessions.findOne({ token_hash: tokenHash }, { projection: { _id: 0, token_hash: 0 } }),
    deleteSession: (tokenHash) => sessions.deleteOne({ token_hash: tokenHash }),
    deleteExpiredSessions: (now) => sessions.deleteMany({ expires_at: { $lte: now } }),
    getLoginAttempts: (address) => loginAttempts.findOne({ address }, { projection: { _id: 0, address: 0 } }),
    setLoginAttempts: (address, count, lockedUntil, updatedAt) => loginAttempts.updateOne(
      { address },
      { $set: { count, locked_until: lockedUntil, updated_at: updatedAt } },
      { upsert: true },
    ),
    clearLoginAttempts: (address) => loginAttempts.deleteOne({ address }),
    trimLoginAttempts: (cutoff) => loginAttempts.deleteMany({ updated_at: { $lt: cutoff } }),
    createActivity: (activity) => activities.insertOne({ ...activity, isRead: false }),
    listActivities: async (offset, limit) => {
      const events = await activities.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1, id: -1 }).skip(offset).limit(limit).toArray();
      return events;
    },
    countActivities: () => activities.countDocuments(),
    countCourseSearchActivities: () => activities.countDocuments({ type: "course_search" }),
    countUnreadActivities: () => activities.countDocuments({ isRead: false }),
    markActivityRead: async (id) => (await activities.updateOne({ id }, { $set: { isRead: true } })).matchedCount > 0,
    markAllActivitiesRead: async () => (await activities.updateMany({ isRead: false }, { $set: { isRead: true } })).modifiedCount,
    clearActivities: () => activities.deleteMany({}),
    close: () => client.close(),
  };
}

async function createDataStore(options = {}) {
  const mongoUri = Object.hasOwn(options, "mongoUri") ? options.mongoUri : process.env.MONGODB_URI;
  if (mongoUri) return createMongoStore(mongoUri, options);
  const dbPath = options.dbPath || options.dataFile || process.env.PATHFINDER_DB_PATH || path.join(__dirname, "data", "pathfinder.sqlite");
  return createSqliteStore(dbPath);
}

module.exports = { createDataStore };
