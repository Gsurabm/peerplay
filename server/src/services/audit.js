import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';

/** Append-only audit trail for every privileged / sensitive action. */
export function audit({ actorId = null, actorRole = null, action, targetType = null, targetId = null, meta = null }) {
  db.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_role, action, target_type, target_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid('aud'),
    actorId,
    actorRole,
    action,
    targetType,
    targetId,
    meta ? JSON.stringify(meta) : null,
    nowIso(),
  );
}

export function listAudit({ limit = 100, offset = 0, action = null } = {}) {
  const where = action ? 'WHERE action LIKE ?' : '';
  const params = action ? [`%${action}%`] : [];
  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
}
