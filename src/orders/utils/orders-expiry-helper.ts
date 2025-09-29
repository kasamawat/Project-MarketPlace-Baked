import { Connection } from "mongoose";

function isTxnRetryable(err: any) {
  return (
    err?.code === 112 || // WriteConflict
    err?.errorLabels?.includes("TransientTransactionError") ||
    err?.errorLabels?.includes("UnknownTransactionCommitResult")
  );
}

export async function runTxnWithRetry<T>(
  conn: Connection,
  fn: (session: import("mongoose").ClientSession) => Promise<T>,
  max = 5,
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < max; i++) {
    const session = await conn.startSession();
    try {
      const res = await session.withTransaction(() => fn(session), {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      });
      await session.endSession();
      return res as T;
    } catch (err) {
      await session.endSession();
      if (!isTxnRetryable(err)) throw err;
      lastErr = err;
      const backoff = Math.min(
        1000 * Math.pow(2, i) + Math.random() * 250,
        5000,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
