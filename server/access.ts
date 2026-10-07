import { all, one, type FileRow, type User } from './db.js';
import { isStaff } from './auth.js';

export const ACTIVE_SUB_STATUSES = ['active', 'trialing'];

export function hasActiveSubscription(clientId: number): boolean {
  return !!one(
    `SELECT 1 FROM subscriptions WHERE client_id = ? AND status IN (${ACTIVE_SUB_STATUSES.map(() => '?').join(',')}) LIMIT 1`,
    clientId,
    ...ACTIVE_SUB_STATUSES,
  );
}

export interface FileAccess {
  locked: boolean;
  reason: string | null;
  invoices: { id: number; number: string; status: string }[];
}

/**
 * Decides whether a file can be downloaded.
 *
 * Staff can always download. For clients:
 *  - files they uploaded themselves are always available;
 *  - an active subscription unlocks every file on the account;
 *  - a file attached to invoices unlocks once any of those invoices is paid;
 *  - a file marked "requires subscription" stays locked without one;
 *  - anything else is available.
 */
export function fileAccess(file: FileRow, user: User, ctx?: { activeSub?: boolean; uploaderRole?: string | null }): FileAccess {
  const invoices = all<{ id: number; number: string; status: string }>(
    `SELECT i.id, i.number, i.status FROM invoice_files f JOIN invoices i ON i.id = f.invoice_id WHERE f.file_id = ? ORDER BY i.id`,
    file.id,
  );
  const open: FileAccess = { locked: false, reason: null, invoices };
  if (isStaff(user)) return open;

  const uploaderRole =
    ctx?.uploaderRole !== undefined
      ? ctx.uploaderRole
      : file.uploaded_by
        ? one<{ role: string }>('SELECT role FROM users WHERE id = ?', file.uploaded_by)?.role ?? null
        : null;
  if (uploaderRole === 'client') return open;

  const activeSub = ctx?.activeSub ?? hasActiveSubscription(file.client_id);
  if (activeSub) return open;

  const billable = invoices.filter((i) => i.status !== 'void' && i.status !== 'draft');
  if (invoices.some((i) => i.status === 'paid')) return open;
  if (invoices.length > 0) {
    const pending = billable[0] ?? invoices[0];
    return {
      locked: true,
      reason:
        pending.status === 'draft'
          ? 'Available after the invoice is issued and paid'
          : `Unlocks when invoice ${pending.number} is paid`,
      invoices,
    };
  }
  if (file.requires_subscription) {
    return { locked: true, reason: 'Requires an active subscription', invoices };
  }
  return open;
}
