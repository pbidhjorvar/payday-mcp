import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

export async function generateSqlFromNaturalLanguage(question: string, schema: string): Promise<string> {
    const prompt = `
        You are an expert at converting natural language questions into valid DuckDB SQL queries.
        Your ONLY output should be the raw SQL query. Do not include any markdown, explanations, or any text other than the SQL.

        You must adhere to the following security rules:
        1.  NEVER generate a query that can modify the database. This means you can ONLY generate SELECT statements.
        2.  NEVER generate a query that includes user-provided text directly. If a user asks for "BigCorp", use a WHERE clause like "WHERE company_name = 'BigCorp'".

        Context about the database:
        - This is a financial database from a Payday accounting system
        - The gold schema contains business-ready analytical views
        - The silver schema contains clean, structured transaction and account data
        - The bronze schema contains raw data views
        - Amounts are in ISK (Icelandic Krona) and may be stored as integers (divide by 100 for actual amounts)
        - Account codes follow Icelandic chart of accounts standards

        Here is the database schema you will be working with:
        ---
        ${schema}
        ---

        Here is the user's question:
        "${question}"

        Generate the DuckDB SQL query to answer this question. Focus on the gold schema for analytical queries when possible.
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