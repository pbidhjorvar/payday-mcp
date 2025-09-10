# Gemini Voice Assistant for DuckDB Financial Analytics

A webhook server that converts natural language queries into DuckDB SQL using Google's Gemini AI, designed for voice-based financial data analysis through Google Assistant.

## Features

- 🎤 Natural language to SQL conversion using Gemini AI
- 🦆 DuckDB integration with your Payday financial data
- 🌐 REST API webhook for Google Assistant integration
- 🔒 Read-only database access for security
- 📊 Financial context-aware query generation

## Setup

### 1. Install Dependencies
```bash
cd gemini-voice-assistant
npm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
```

Edit `.env` and add your Google AI Studio API key:
```
GEMINI_API_KEY="your_actual_api_key_here"
```

To get a Gemini API key:
1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Copy it to your `.env` file

### 3. Build and Run
```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### POST /webhook
Main webhook endpoint for natural language queries.

**Request:**
```json
{
  "query": "What are the top accounts by transaction count?"
}
```

**Response:**
```json
{
  "fulfillmentText": "The query returned 5 results.",
  "generatedSql": "SELECT account_code, account_name, transaction_count FROM gold.account_summary ORDER BY transaction_count DESC LIMIT 5",
  "data": [...]
}
```

### GET /health
Health check endpoint.

### GET /test-schema
Returns the database schema for debugging.

## Example Queries

- "What are the top accounts by transaction count?"
- "Show me the account balances"
- "What's our cash flow this month?"
- "Which accounts have the highest activity?"
- "Show me recent transactions"

## Database Schema

The webhook connects to your populated DuckDB database with:

- **Gold Schema**: Business-ready analytical views (account_summary, etc.)
- **Silver Schema**: Clean transaction and account data
- **Bronze Schema**: Raw data views

## Security

- Database is opened in READ_ONLY mode
- Only SELECT statements are allowed
- Query validation prevents data modification
- Basic input sanitization

## Development

The project uses TypeScript and includes:
- Express.js web server
- Google Generative AI SDK
- DuckDB Node.js driver
- Development hot reload with nodemon

## Integration Notes

This is a basic webhook implementation. For full Google Assistant integration, you'll need to:

1. Deploy to a public server (or use ngrok for testing)
2. Configure Google Actions Console
3. Set up proper authentication
4. Handle Google Assistant-specific request/response formats