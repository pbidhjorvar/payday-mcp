// src/tools/duckdb_sql.ts
import { z } from "zod";

// Try to import DuckDB, fallback gracefully if not available
let duckdb: any;
try {
  duckdb = require("duckdb");
} catch (error) {
  console.warn("DuckDB not available - SQL tools will return error messages");
  duckdb = null;
}

const DB_PATH = "duckdb/finance.duckdb";

// Schemas we allow the AI to use
const ALLOWED_SCHEMAS = new Set(["gold", "silver", "dim", "main"]);

// Forbidden keywords to ensure SELECT-only (very defensive)
const FORBIDDEN = [
  "\\binsert\\b","\\bupdate\\b","\\bdelete\\b","\\bdrop\\b","\\bcreate\\b","\\balter\\b",
  "\\battach\\b","\\bdetach\\b","\\bcopy\\b","\\bexport\\b","\\bimport\\b","\\bload\\b",
  "\\bpragma\\b","\\bset\\b","\\bvacuum\\b","\\bcheckpoint\\b","\\btransaction\\b",
  "\\bbegin\\b","\\bcommit\\b","\\brollback\\b","\\bcall\\b"
];

function sanitizeSql(sql: string): string {
  // Remove line & block comments and normalize whitespace
  let s = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.trim();
  return s;
}

function assertSelectOnly(sql: string) {
  const s = sanitizeSql(sql).toLowerCase();

  // Single statement only
  // (Allow trailing semicolon, but reject multiple statements)
  const segments = s.split(";").filter(x => x.trim().length > 0);
  if (segments.length > 1) {
    throw new Error("Only a single SELECT statement is allowed.");
  }

  // Must start with SELECT or WITH
  if (!/^(select|with)\b/.test(segments[0].trim())) {
    throw new Error("Only SELECT/CTE queries are allowed.");
  }

  // Block dangerous keywords
  const forbiddenRe = new RegExp(FORBIDDEN.join("|"), "i");
  if (forbiddenRe.test(segments[0])) {
    throw new Error("Query contains forbidden keywords. Only read-only SELECT is permitted.");
  }

  // Optional: restrict schema usage (basic heuristic)
  // Encourage schema-qualified names; not a hard fail, but we check obvious DDL bypasses above.
}

function connectRO(): any {
  if (!duckdb) {
    throw new Error("DuckDB is not installed. Please run: npm install duckdb");
  }
  // @ts-ignore (node-duckdb supports options)
  return new duckdb.Database(DB_PATH, { readonly: true });
}

function all<T=any>(sql: string, params: any[] = []): Promise<T[]> {
  if (!duckdb) {
    return Promise.reject(new Error("DuckDB is not installed. Please run: npm install duckdb"));
  }
  const db = connectRO();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: any, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// -------- Tools --------

// Introspect: list schemas/tables/views
export const duckdb_list_objects = {
  name: "duckdb_list_objects",
  description: "List schemas, tables, and views available to query.",
  inputSchema: z.object({
    schema: z.string().optional() // if omitted, returns all allowed schemas
  }),
  handler: async (input: { schema?: string }, _profileName?: string, _profile?: any, _client?: any) => {
    const schemaFilter = input.schema ? `AND table_schema = '${input.schema}'` : "";
    const sql = `
      SELECT table_schema AS schema, table_name AS name, table_type AS type
      FROM information_schema.tables
      WHERE table_schema IN (${Array.from(ALLOWED_SCHEMAS).map(s=> `'${s}'`).join(",")})
      ${schemaFilter}
      ORDER BY table_schema, table_type, table_name;
    `;
    const rows = await all(sql);
    return { objects: rows };
  }
};

// Introspect: columns for a table
export const duckdb_table_info = {
  name: "duckdb_table_info",
  description: "Get column names and types for a schema.table.",
  inputSchema: z.object({
    schema: z.string(),
    table: z.string()
  }),
  handler: async (input: { schema: string; table: string }, _profileName?: string, _profile?: any, _client?: any) => {
    if (!ALLOWED_SCHEMAS.has(input.schema)) {
      throw new Error(`Schema not allowed: ${input.schema}`);
    }
    const sql = `
      SELECT column_name AS name, data_type AS type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position;
    `;
    const rows = await all(sql, [input.schema, input.table]);
    return { columns: rows };
  }
};

// Explain: get logical plan for a query (helps AI debug)
export const duckdb_explain = {
  name: "duckdb_explain",
  description: "Explain plan for a SELECT/CTE query (read-only).",
  inputSchema: z.object({
    sql: z.string()
  }),
  handler: async (input: { sql: string }, _profileName?: string, _profile?: any, _client?: any) => {
    assertSelectOnly(input.sql);
    const plan = await all<{explain:string}>(`EXPLAIN ${sanitizeSql(input.sql)}`);
    return { plan: plan.map(r => r.explain).join("\n") };
  }
};

// Execute: SELECT-only query with optional params & limits
export const duckdb_sql_select = {
  name: "duckdb_sql_select",
  description: "Run a single SELECT/CTE query (read-only) against DuckDB and return rows.",
  inputSchema: z.object({
    sql: z.string(),
    params: z.array(z.any()).default([]),
    max_rows: z.number().default(5000),
    format: z.enum(["json","csv","markdown"]).default("json")
  }),
  handler: async (input: { sql: string; params?: any[]; max_rows?: number; format?: "json"|"csv"|"markdown" }, _profileName?: string, _profile?: any, _client?: any) => {
    const { sql, params = [], max_rows = 5000, format = "json" } = input;
    assertSelectOnly(sql);

    // Wrap with LIMIT if caller forgot (duckdb supports LIMIT on outermost query)
    let q = sanitizeSql(sql);
    if (!/\blimit\s+\d+\b/i.test(q)) {
      q += ` LIMIT ${Math.max(1, Math.min(max_rows, 100000))}`;
    }

    const rows = await all<any>(q, params);

    if (format === "csv") {
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const header = cols.join(",");
      const lines = rows.map(r => cols.map(c => JSON.stringify(r[c] ?? "")).join(","));
      return { mime: "text/csv", content: [header, ...lines].join("\n") };
    }

    if (format === "markdown") {
      if (rows.length === 0) return { mime: "text/markdown", content: "| (no rows) |\n|---|" };
      const cols = Object.keys(rows[0]);
      const head = `| ${cols.join(" | ")} |`;
      const sep = `| ${cols.map(()=>"-").join(" | ")} |`;
      const body = rows.map(r => `| ${cols.map(c => (r[c] ?? "")).join(" | ")} |`).join("\n");
      return { mime: "text/markdown", content: `${head}\n${sep}\n${body}` };
    }

    return { mime: "application/json", content: JSON.stringify(rows, null, 2) };
  }
};