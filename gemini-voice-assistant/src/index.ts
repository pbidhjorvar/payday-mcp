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
            generatedSql: sql,
            data: results.slice(0, 10) // Limit to first 10 results for voice response
        });

    } catch (error: any) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Gemini Voice Assistant is running' });
});

// Test endpoint for development
app.get('/test-schema', async (req, res) => {
    try {
        const schema = await getSchema();
        res.status(200).json({ schema });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Test schema: http://localhost:${PORT}/test-schema`);
});