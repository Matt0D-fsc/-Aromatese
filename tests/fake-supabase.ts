// Enough of the Supabase client to drive the agent and the inbound pipeline without a database.
//
// A handler per table (or "rpc:name") is asked what to return, and is handed what the caller built: the
// method, the arguments and every filter in order. That means a test can both stub a read and assert on the
// write — "it inserted a bot message with this text" — which is most of what these tests are checking.
//
// Deliberately not a Postgres: filters are recorded, never applied. A handler returns the rows it wants.

export type Op = {
  table: string;
  method: 'select' | 'insert' | 'upsert' | 'update' | 'delete' | 'rpc';
  /** Arguments to the method itself: the column list, the row being written, the rpc parameters. */
  args: unknown[];
  /** Every filter and modifier in call order, e.g. ['eq', 'tenant_id', '...'] or ['limit', 20]. */
  filters: unknown[][];
};

export type Result = { data?: unknown; error?: unknown; count?: number };
export type Handler = Result | ((op: Op) => Result);

// Everything that narrows a query and hands the builder back.
const CHAIN = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'not', 'like', 'ilike', 'match', 'or', 'filter', 'order', 'limit', 'range', 'select'];
const METHODS = ['select', 'insert', 'upsert', 'update', 'delete'] as const;

export function fakeDb(handlers: Record<string, Handler>) {
  /** Every operation the code under test performed, in order, for assertions afterwards. */
  const ops: Op[] = [];

  const resolve = (op: Op): Result => {
    const handler = handlers[op.table];
    if (!handler) throw new Error(`fakeDb: nothing registered for "${op.table}" (${op.method}). Add a handler in the test.`);
    const result = typeof handler === 'function' ? handler(op) : handler;
    return { data: null, error: null, ...result };
  };

  const builder = (op: Op) => {
    const chain: Record<string, unknown> = {
      // Thenable, so `await query` and the fire-and-forget `.then(...)` in the agent both work.
      then: (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => Promise.resolve(resolve(op)).then(onFulfilled, onRejected),
      single: async () => resolve(op),
      maybeSingle: async () => resolve(op),
    };
    for (const name of CHAIN) {
      chain[name] = (...args: unknown[]) => {
        // select() after insert() names the columns to return; it must not overwrite the method.
        if (name === 'select' && op.method === 'select') op.args = args;
        else op.filters.push([name, ...args]);
        return chain;
      };
    }
    return chain;
  };

  const db = {
    ops,
    from(table: string) {
      const entry: Record<string, unknown> = {};
      for (const method of METHODS) {
        entry[method] = (...args: unknown[]) => {
          const op: Op = { table, method, args, filters: [] };
          ops.push(op);
          return builder(op);
        };
      }
      return entry;
    },
    rpc(name: string, args?: unknown) {
      const op: Op = { table: `rpc:${name}`, method: 'rpc', args: [args], filters: [] };
      ops.push(op);
      return builder(op);
    },
  };
  return db;
}

export type FakeDb = ReturnType<typeof fakeDb>;

/** The operations performed against one table, oldest first. */
export const opsOn = (db: FakeDb, table: string) => db.ops.filter((op) => op.table === table);

/** The row (or rows) handed to the first insert or upsert on a table. */
export const written = (db: FakeDb, table: string) => opsOn(db, table).find((op) => op.method === 'insert' || op.method === 'upsert')?.args[0];
