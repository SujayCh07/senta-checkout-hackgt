import { withTransaction } from './database.js';

const migrations = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX sessions_user_expiry ON sessions(user_id, expires_at);

      CREATE TABLE restaurants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE menu_items (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        catalog_version INTEGER NOT NULL CHECK (catalog_version > 0),
        UNIQUE (restaurant_id, name)
      ) STRICT;
      CREATE INDEX menu_items_active ON menu_items(restaurant_id, active, name);

      CREATE TABLE modifiers (
        id TEXT PRIMARY KEY,
        menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        price_delta_cents INTEGER NOT NULL,
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        UNIQUE (menu_item_id, name)
      ) STRICT;

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX conversations_owner_updated ON conversations(user_id, updated_at DESC);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        UNIQUE (conversation_id, sequence)
      ) STRICT;
      CREATE INDEX messages_conversation_sequence ON messages(conversation_id, sequence);

      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'checkout_pending', 'payment_unknown', 'paid', 'canceled')),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX orders_owner_updated ON orders(user_id, updated_at DESC);

      CREATE TABLE order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
        item_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
        modifiers_json TEXT NOT NULL DEFAULT '[]',
        line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
      ) STRICT;

      CREATE TABLE checkout_attempts (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        order_revision INTEGER NOT NULL CHECK (order_revision > 0),
        status TEXT NOT NULL CHECK (status IN ('creating', 'open', 'payment_unknown', 'paid', 'expired', 'failed')),
        provider_session_id TEXT UNIQUE,
        checkout_url TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX checkout_attempt_order ON checkout_attempts(order_id, created_at DESC);

      CREATE TABLE provider_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_type TEXT NOT NULL,
        checkout_attempt_id TEXT REFERENCES checkout_attempts(id) ON DELETE SET NULL,
        received_at INTEGER NOT NULL,
        processed_at INTEGER,
        processing_error TEXT
      ) STRICT;

      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      ) STRICT;
      CREATE INDEX outbox_pending ON outbox_events(created_at) WHERE delivered_at IS NULL;
    `,
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);
  const hasMigration = db.prepare('SELECT 1 AS found FROM schema_migrations WHERE name = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  const applied = [];

  for (const migration of migrations) {
    if (hasMigration.get(migration.name)) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      recordMigration.run(migration.name, Date.now());
    });
    applied.push(migration.name);
  }
  return { applied };
}

export function listMigrations() {
  return migrations.map(({ name }) => name);
}
