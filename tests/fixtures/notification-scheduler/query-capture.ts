import type postgres from "postgres";
import type { PgClient } from "../notification-outbox/postgres-harness";
import {
  captureTransactionSql,
  type CapturedTaggedQuery,
} from "../notification-outbox/query-capture";

type TransactionCallback = (tx: postgres.TransactionSql) => Promise<unknown>;
type BeginOne = (callback: TransactionCallback) => Promise<unknown>;
type BeginTwo = (options: string, callback: TransactionCallback) => Promise<unknown>;

/** Preserve the real client and transaction while recording production tagged SQL verbatim. */
export function captureSchedulerPool(client: PgClient, captures: CapturedTaggedQuery[]): PgClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "begin") return Reflect.get(target, property, receiver);
      return (first: string | TransactionCallback, second?: TransactionCallback) => {
        if (typeof first === "function") {
          return (target.begin as unknown as BeginOne)((tx) =>
            first(captureTransactionSql(tx, captures)),
          );
        }
        if (!second) throw new Error("Notification captured transaction callback is missing");
        return (target.begin as unknown as BeginTwo)(first, (tx) =>
          second(captureTransactionSql(tx, captures)),
        );
      };
    },
  });
}

export function findCapturedQuery(
  captures: readonly CapturedTaggedQuery[],
  ...needles: readonly string[]
) {
  const found = captures.find((capture) =>
    needles.every((needle) => capture.normalized.includes(needle)),
  );
  if (!found) {
    throw new Error(`Production notification query was not captured: ${needles.join(" | ")}`);
  }
  return found;
}
