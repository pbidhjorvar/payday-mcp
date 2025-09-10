import Database from 'better-sqlite3';
import * as path from 'path';

// Path to your SQLite database file
const dbPath = path.join(__dirname, '../../sqlite/finance.db');

// Create read-only database connection
const db = new Database(dbPath, { readonly: true });

export async function executeQuery(sql: string): Promise<any[]> {
    try {
        const stmt = db.prepare(sql);
        return stmt.all();
    } catch (error) {
        throw new Error(`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function getSchema(): Promise<string> {
    try {
        // Get all tables from SQLite with schema prefixes
        const tables = db.prepare(`
            SELECT 
                name as table_name,
                type as table_type
            FROM sqlite_master
            WHERE type IN ('table', 'view')
            AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `).all() as Array<{table_name: string, table_type: string}>;

        const schemaDescriptions = [];
        
        for (const table of tables) {
            // Extract schema from table name if it follows schema.table pattern
            let schema = 'main';
            let tableName = table.table_name;
            
            if (table.table_name.includes('.')) {
                [schema, tableName] = table.table_name.split('.');
            }
            
            // Get columns for each table
            const columns = db.prepare(`PRAGMA table_info('${table.table_name}')`).all() as Array<{name: string, type: string}>;
            const columnInfo = columns.map(col => `${col.name} (${col.type})`).join(', ');
            
            schemaDescriptions.push(`Table: ${table.table_name} (${table.table_type})
Columns: ${columnInfo}`);
        }
        
        return schemaDescriptions.join('\n---\n');
    } catch (error) {
        throw new Error(`Schema retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// Close database on process exit
process.on('exit', () => db.close());
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});