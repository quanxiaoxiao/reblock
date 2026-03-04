import mongoose from 'mongoose';

/**
 * Shared transaction utilities for services that need MongoDB transaction support.
 * Eliminates code duplication between ResourceService and EntryService.
 */

let transactionsSupported: boolean | null = null;

/**
 * Check if the current MongoDB deployment supports transactions (replica set or mongos).
 * Result is cached after first check.
 */
export async function canUseTransactions(): Promise<boolean> {
  if (transactionsSupported !== null) {
    return transactionsSupported;
  }

  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) {
      transactionsSupported = false;
      return false;
    }
    const hello = await admin.command({ hello: 1 });
    const isReplicaSet = Boolean(hello?.setName);
    const isMongos = hello?.msg === 'isdbgrid';
    transactionsSupported = isReplicaSet || isMongos;
    return transactionsSupported;
  } catch {
    transactionsSupported = false;
    return false;
  }
}

/**
 * Check if an error indicates that transactions are not supported.
 * Used to gracefully fallback when running on standalone MongoDB.
 */
export function isTransactionUnsupportedError(error: unknown): boolean {
  const errorLike = error as { message?: string; code?: number; codeName?: string };
  const message = (errorLike?.message || '').toLowerCase();
  const codeName = (errorLike?.codeName || '').toLowerCase();
  const code = errorLike?.code;
  if (!message && !codeName && typeof code !== 'number') return false;
  return (
    message.includes('transaction numbers are only allowed on a replica set member') ||
    message.includes('transaction numbers are only allowed on a mongos') ||
    message.includes('transactions are not supported') ||
    message.includes('standalone servers do not support transactions') ||
    message.includes('current topology does not support sessions') ||
    message.includes('this deployment does not support retryable writes') ||
    codeName.includes('illegaloperation') ||
    codeName.includes('nosuchtransaction') ||
    code === 20
  );
}

/**
 * Reset the cached transaction support flag.
 * Called when a transaction-unsupported error is detected at runtime.
 */
export function markTransactionsUnsupported(): void {
  transactionsSupported = false;
}
