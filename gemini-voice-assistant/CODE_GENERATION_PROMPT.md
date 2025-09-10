You are an expert full-stack TypeScript developer. Your task is to create a complete, self-contained Node.js web server project in a folder named `gemini-voice-assistant`.

This server will act as a webhook for Google Assistant. It will receive natural language queries, use the Gemini API to convert them into SQLite SQL, execute the SQL against a local database, and return the result.

Create the following files with the exact contents specified.

**File: `gemini-voice-assistant/package.json`**
```json
{
  "name": "gemini-voice-assistant",
  "version": "1.0.0",
  "description": "A voice-to-SQL webhook for Google Assistant and SQLite.",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "nodemon src/index.ts"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@google/generative-ai": "^0.7.0",
    "sqlite3": "^5.1.7",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.7",
    "@types/sqlite3": "^3.1.11",
    "nodemon": "^3.1.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
```

**File: `gemini-voice-assistant/tsconfig.json`**
```json
{
  "compilerOptions": {
    "target": "es6",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**File: `gemini-voice-assistant/.env.example`**
```
# Your Google AI Studio API Key for the Gemini model
GEMINI_API_KEY="YOUR_API_KEY_HERE"
```

**File: `gemini-voice-assistant/src/database.ts`**
```typescript
import sqlite3 from 'sqlite3';

// Path to your gold-layer SQLite file
const dbPath = '../../data/gold/mcp_gold.sqlite';

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error(`Error connecting to database: ${err.message}`);
    }
});

export async function executeQuery(sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, [], (err, rows) => {
            if (err) {
                return reject(err);
            }
            resolve(rows);
        });
    });
}

export async function getSchema(): Promise<string> {
    return new Promise((resolve, reject) => {
        db.all("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%';", [], (err, tables) => {
            if (err) {
                return reject(err);
            }
            const schemaDescriptions = tables.map(table => `Table Name: ${table.name}\nSchema:\n${table.sql}\n`);
            resolve(schemaDescriptions.join('\n---\n'));
        });
    });
}
```

**File: `gemini-voice-assistant/src/gemini-sql.ts`**
```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

export async function generateSqlFromNaturalLanguage(question: string, schema: string): Promise<string> {
    const prompt = `
        You are an expert at converting natural language questions into valid SQLite SQL queries.
        Your ONLY output should be the raw SQL query. Do not include any markdown, explanations, or any text other than the SQL.

        You must adhere to the following security rules:
        1.  NEVER generate a query that can modify the database. This means you can ONLY generate SELECT statements.
        2.  NEVER generate a query that includes user-provided text directly. If a user asks for "BigCorp", use a WHERE clause like "WHERE company_name = 'BigCorp'".

        Here is the database schema you will be working with:
        ---
        ${schema}
        ---

        Here is the user's question:
        "${question}"

        Generate the SQLite SQL query to answer this question.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        // Clean up potential markdown backticks
        text = text.replace(/```sql/g, '').replace(/```/g, '').trim();
        
        if (!text.toUpperCase().startsWith('SELECT')) {
            throw new Error('Generated query is not a SELECT statement.');
        }

        return text;
    } catch (error) {
        console.error("Error generating SQL:", error);
        throw new Error("Failed to generate SQL from the natural language query.");
    }
}
```

**File: `gemini-voice-assistant/src/index.ts`**
```typescript
import express from 'express';
import { getSchema, executeQuery } from './database';
import { generateSqlFromNaturalLanguage } from './gemini-sql';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/webhook', async (req, res) => {
    // This is a simplified request body structure.
    // You will need to adapt this to the actual request body from Google Actions.
    const queryText = req.body.query;

    if (!queryText) {
        return res.status(400).json({ error: 'No query text provided.' });
    }

    try {
        console.log(`Received query: ${queryText}`);

        // 1. Get DB Schema
        const schema = await getSchema();
        console.log("Successfully retrieved DB schema.");

        // 2. Generate SQL from query
        const sql = await generateSqlFromNaturalLanguage(queryText, schema);
        console.log(`Generated SQL: ${sql}`);

        // 3. Execute SQL
        const results = await executeQuery(sql);
        console.log(`Query returned ${results.length} results.`);

        // 4. Format and send response
        // This is a simple response. Google Assistant requires a specific JSON format.
        res.status(200).json({
            fulfillmentText: `The query returned ${results.length} results.`, 
            data: results
        });

    } catch (error: any) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
```