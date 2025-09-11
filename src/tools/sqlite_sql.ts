// src/tools/sqlite_sql.ts
import { z } from "zod";
import { createApiError } from '../http/errors.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Import better-sqlite3
import Database from 'better-sqlite3';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Navigate from src/tools to project root, then to sqlite folder
const DB_PATH = join(__dirname, '..', '..', 'sqlite', 'finance.db');

// Schemas we allow the AI to use (SQLite doesn't have schemas like DuckDB, so we'll use table prefixes)
// const ALLOWED_PREFIXES = ["gold_", "silver_", "dim_"];

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
}

let db: Database.Database | null = null;

function connectRO(): Database.Database {
  if (db) return db;
  
  // Check if database file exists
  if (!existsSync(DB_PATH)) {
    throw new Error(`SQLite database file not found at: ${DB_PATH}. Please ensure the database file exists.`);
  }
  
  // Connect to existing database file with read-only mode
  db = new Database(DB_PATH, { readonly: true });
  return db;
}

// Close database on process exit
process.on('exit', () => {
  if (db) db.close();
});
process.on('SIGINT', () => {
  if (db) db.close();
  process.exit(0);
});

// -------- Tools --------

// Introspect: list tables/views
export const sqlite_list_objects = {
  name: "sqlite_list_objects",
  description: `List tables and views available to query in the finance database.

🎯 KEY TABLES & VIEWS:

📊 SILVER LAYER (Clean Data):
• silver_account_statements - All transactions with proper typing
• dim_accounts - Chart of accounts master data

🏆 GOLD LAYER (Business Analytics):  
• gold_account_summary - Account totals, transaction counts, date ranges
• gold_monthly_pl - Monthly profit & loss by account type
• gold_balance_sheet - Balance sheet positions by account
• gold_account_detail - Enhanced account info with activity

💡 USAGE TIPS:
• Use prefix filter: {"prefix": "gold_"} to see only Gold views
• Start with gold_ views for business analysis
• Use silver_ tables for detailed transaction queries
• dim_ tables contain master data (accounts, etc.)`,
  inputSchema: z.object({
    prefix: z.string().optional().describe('Filter by table prefix: "gold_", "silver_", "dim_"')
  }),
  handler: async (input: { prefix?: string }, _profileName?: string, _profile?: any, _client?: any) => {
    try {
      const database = connectRO();
      let sql = `
        SELECT 
          name,
          type,
          CASE 
            WHEN name LIKE 'gold_%' THEN 'gold'
            WHEN name LIKE 'silver_%' THEN 'silver'
            WHEN name LIKE 'dim_%' THEN 'dim'
            ELSE 'main'
          END as schema
        FROM sqlite_master
        WHERE type IN ('table', 'view')
        AND name NOT LIKE 'sqlite_%'
      `;
      
      let params: any[] = [];
      if (input.prefix) {
        sql += ` AND name LIKE ?`;
        params.push(`${input.prefix}%`);
      }
      
      sql += ` ORDER BY schema, type, name`;
      
      const stmt = database.prepare(sql);
      const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
      
      return { ok: true, objects: rows };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('database file not found')) {
        return createApiError(500, 'CONNECTION_ERROR', 'SQLite connection failed. Check if database file exists at: ' + DB_PATH);
      }
      return createApiError(500, 'QUERY_ERROR', message);
    }
  }
};

// Introspect: columns for a table
export const sqlite_table_info = {
  name: "sqlite_table_info",
  description: `Get column names and types for a table or view.

📋 MOST USEFUL TABLES TO EXPLORE:
• silver_account_statements - Core transaction data
• gold_account_summary - Pre-calculated account totals
• gold_monthly_pl - Monthly P&L breakdown
• dim_accounts - Chart of accounts

💡 After getting table info, use sqlite_sql_select with proper column names and parameters!`,
  inputSchema: z.object({
    table: z.string().describe('Table name (e.g., "silver_account_statements", "gold_account_summary")')
  }),
  handler: async (input: { table: string }, _profileName?: string, _profile?: any, _client?: any) => {
    try {
      const database = connectRO();
      // Validate table name to prevent injection
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.table)) {
        return createApiError(400, 'VALIDATION_ERROR', 'Invalid table name. Must contain only letters, numbers, and underscores.', {
          suggestion: 'Use sqlite_list_objects to see available table names',
          example: 'Valid names: silver_account_statements, gold_account_summary'
        });
      }
      
      const stmt = database.prepare(`PRAGMA table_info(?)`);
      const columns = stmt.all(input.table);
      
      const formattedColumns = columns.map((col: any) => ({
        name: col.name,
        type: col.type,
        is_nullable: col.notnull === 0
      }));
      
      return { ok: true, columns: formattedColumns };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('database file not found')) {
        return createApiError(500, 'CONNECTION_ERROR', 'SQLite connection failed. Check if database file exists at: ' + DB_PATH);
      }
      return createApiError(500, 'QUERY_ERROR', message);
    }
  }
};

// Explain: get query plan
export const sqlite_explain = {
  name: "sqlite_explain",
  description: "Explain query plan for a SELECT/CTE query (read-only).",
  inputSchema: z.object({
    sql: z.string()
  }),
  handler: async (input: { sql: string }, _profileName?: string, _profile?: any, _client?: any) => {
    try {
      assertSelectOnly(input.sql);
      const database = connectRO();
      const stmt = database.prepare(`EXPLAIN QUERY PLAN ${sanitizeSql(input.sql)}`);
      const plan = stmt.all();
      
      return { ok: true, plan: plan.map((r: any) => `${r.id}: ${r.detail}`).join("\n") };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('database file not found')) {
        return createApiError(500, 'CONNECTION_ERROR', 'SQLite database not found', {
          suggestion: 'Run the populate script to create the database',
          example: 'npx tsx scripts/populate-sqlite.ts'
        });
      }
      if (message.includes('forbidden') || message.includes('SELECT')) {
        return createApiError(400, 'VALIDATION_ERROR', message, {
          suggestion: 'Only SELECT and WITH queries are allowed. Use ? placeholders for parameters.',
          example: 'sql: "SELECT account_name, SUM(debit) FROM silver_account_statements WHERE account_type = ? AND transaction_date >= ? GROUP BY account_name", params: ["Gjöld", "2023-01-01"]'
        });
      }
      return createApiError(500, 'QUERY_ERROR', message, {
        suggestion: 'Check SQL syntax and table names. Use parameters for safe queries.',
        example: 'sql: "SELECT * FROM gold_account_summary WHERE transaction_count > ? LIMIT ?", params: [10, 20]. Run sqlite_list_objects to see available tables'
      });
    }
  }
};

// Execute: SELECT-only query with optional params & limits
export const sqlite_sql_select = {
  name: "sqlite_sql_select",
  description: `Run a single SELECT/CTE query (read-only) against SQLite and return rows.

🔥 PARAMETER EXAMPLES - Use ? placeholders for safe queries:

📊 FINANCIAL ANALYSIS EXAMPLES:
• Monthly revenue 2023: 
  sql: "SELECT strftime('%Y-%m', transaction_date) as month, SUM(credit-debit) as revenue FROM silver_account_statements WHERE transaction_date >= ? AND account_type = ? GROUP BY month ORDER BY month"
  params: ["2023-01-01", "Tekjur"]

• Account balance over time:
  sql: "SELECT transaction_date, account_name, balance FROM silver_account_statements WHERE account_code = ? AND transaction_date BETWEEN ? AND ? ORDER BY transaction_date"
  params: ["3200", "2023-01-01", "2023-12-31"]

• Top expenses by category:
  sql: "SELECT account_name, SUM(debit) as total_expense FROM silver_account_statements WHERE account_type = ? AND transaction_date LIKE ? GROUP BY account_name ORDER BY total_expense DESC LIMIT ?"
  params: ["Gjöld", "2023%", 10]

📈 GOLD LAYER VIEWS (pre-built analytics):
• gold_account_summary - Account totals and activity
• gold_monthly_pl - Monthly profit & loss breakdown  
• gold_balance_sheet - Balance sheet positions
• gold_account_detail - Enhanced account information

⚡ PERFORMANCE TIPS:
• Always use date filters: transaction_date >= '2023-01-01'
• Use LIMIT for large result sets
• Parameters prevent SQL injection: params: ["value1", "value2"]`,
  inputSchema: z.object({
    sql: z.string().describe("SELECT query with ? placeholders for parameters"),
    params: z.array(z.any()).default([]).describe("Array of parameter values to replace ? placeholders in order"),
    max_rows: z.number().default(5000).describe("Maximum rows to return (default 5000)"),
    format: z.enum(["json","csv","markdown"]).default("json").describe("Output format")
  }),
  handler: async (input: { sql: string; params?: any[]; max_rows?: number; format?: "json"|"csv"|"markdown" }, _profileName?: string, _profile?: any, _client?: any) => {
    try {
      const { sql, params = [], max_rows = 5000, format = "json" } = input;
      assertSelectOnly(sql);

      // Wrap with LIMIT if caller forgot
      let q = sanitizeSql(sql);
      if (!/\blimit\s+\d+\b/i.test(q)) {
        q += ` LIMIT ${Math.max(1, Math.min(max_rows, 100000))}`;
      }

      const database = connectRO();
      const stmt = database.prepare(q);
      const rows = params.length > 0 ? stmt.all(...params) : stmt.all() as any[];

      if (format === "csv") {
        const cols = rows.length ? Object.keys(rows[0]) : [];
        const header = cols.join(",");
        const lines = rows.map((r: any) => cols.map(c => JSON.stringify(r[c] ?? "")).join(","));
        return { ok: true, mime: "text/csv", content: [header, ...lines].join("\n") };
      }

      if (format === "markdown") {
        if (rows.length === 0) return { ok: true, mime: "text/markdown", content: "| (no rows) |\n|---|" };
        const cols = Object.keys(rows[0]);
        const head = `| ${cols.join(" | ")} |`;
        const sep = `| ${cols.map(()=>"-").join(" | ")} |`;
        const body = rows.map((r: any) => `| ${cols.map(c => (r[c] ?? "")).join(" | ")} |`).join("\n");
        return { ok: true, mime: "text/markdown", content: `${head}\n${sep}\n${body}` };
      }

      return { ok: true, mime: "application/json", content: JSON.stringify(rows, null, 2) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.includes('database file not found')) {
        return createApiError(500, 'CONNECTION_ERROR', 'SQLite database not found', {
          suggestion: 'Run the populate script to create the database',
          example: 'npx tsx scripts/populate-sqlite.ts'
        });
      }
      if (message.includes('forbidden') || message.includes('SELECT')) {
        return createApiError(400, 'VALIDATION_ERROR', message, {
          suggestion: 'Only SELECT and WITH queries are allowed. Use ? placeholders for parameters.',
          example: 'sql: "SELECT account_name, SUM(debit) FROM silver_account_statements WHERE account_type = ? AND transaction_date >= ? GROUP BY account_name", params: ["Gjöld", "2023-01-01"]'
        });
      }
      return createApiError(500, 'QUERY_ERROR', message, {
        suggestion: 'Check SQL syntax and table names. Use parameters for safe queries.',
        example: 'sql: "SELECT * FROM gold_account_summary WHERE transaction_count > ? LIMIT ?", params: [10, 20]. Run sqlite_list_objects to see available tables'
      });
    }
  }
};