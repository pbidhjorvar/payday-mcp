import { z } from 'zod';
import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { createApiError } from '../http/errors.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const getBankTransactionsSchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().describe('Start date for transactions (YYYY-MM-DD)'),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional().describe('End date for transactions (YYYY-MM-DD)'),
  accountNumber: z.string().optional().describe('Specific account number to filter (e.g., "0133-26-007035")'),
  accountType: z.enum(['bank', 'card', 'all']).optional().default('all').describe('Type of accounts to include: bank accounts, credit cards, or all'),
  limit: z.number().int().min(1).max(1000).optional().default(100).describe('Maximum number of transactions to return'),
});

export async function getBankTransactions(
  input: z.infer<typeof getBankTransactionsSchema>,
  _profileName: string,
  _profile: Profile,
  _client: PaydayClient
) {
  try {
    const startTime = Date.now();
    
    // Get the database path (assuming it's in sqlite/finance.db relative to project root)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const projectRoot = path.resolve(__dirname, '..', '..');
    const dbPath = path.join(projectRoot, 'sqlite', 'finance.db');
    
    // Check if database exists
    let db;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch (error) {
      return createApiError(
        404,
        'DATABASE_NOT_FOUND',
        `Bank database not found at ${dbPath}. Run bank data sync first.`,
        {
          suggestion: 'Run the bank data fetching and parsing scripts to create the SQLite database',
          example: 'node Bank/fetch-raw.js && node Bank/parse-raw.js'
        }
      );
    }

    const transactions: any[] = [];
    
    // Build date filter conditions
    const dateConditions: string[] = [];
    const params: any = {};
    
    if (input.fromDate) {
      dateConditions.push('date >= $fromDate');
      params.fromDate = input.fromDate;
    }
    
    if (input.toDate) {
      dateConditions.push('date <= $toDate');
      params.toDate = input.toDate;
    }
    
    const dateFilter = dateConditions.length > 0 ? `WHERE ${dateConditions.join(' AND ')}` : '';
    
    // Fetch bank account transactions if requested
    if (input.accountType === 'all' || input.accountType === 'bank') {
      let bankQuery = `
        SELECT 
          'bank' as account_type,
          (branch || '-' || ledger || '-' || account_no) as account_number,
          value_date as date,
          description,
          amount,
          balance,
          reference as reference_number,
          currency,
          type_code as transaction_type
        FROM silver_bank_transactions 
        ${dateFilter.replace('date', 'value_date')}
      `;
      
      if (input.accountNumber) {
        bankQuery += dateConditions.length > 0 ? ' AND ' : ' WHERE ';
        bankQuery += '(branch || \'-\' || ledger || \'-\' || account_no) = $accountNumber';
        params.accountNumber = input.accountNumber;
      }
      
      bankQuery += ' ORDER BY value_date DESC, account_number';
      
      if (input.limit) {
        bankQuery += ` LIMIT $limit`;
        params.limit = input.accountType === 'all' ? Math.floor(input.limit / 2) : input.limit;
      }
      
      const bankTransactions = db.prepare(bankQuery).all(params);
      transactions.push(...bankTransactions);
    }
    
    // Fetch credit card transactions if requested
    if (input.accountType === 'all' || input.accountType === 'card') {
      let cardQuery = `
        SELECT 
          'card' as account_type,
          card_id as account_number,
          date,
          description,
          amount,
          NULL as balance,
          NULL as reference_number,
          currency,
          'CARD_TRANSACTION' as transaction_type,
          merchant_name,
          NULL as card_number_masked
        FROM silver_creditcard_transactions 
        ${dateFilter}
      `;
      
      if (input.accountNumber) {
        cardQuery += (dateFilter ? ' AND ' : ' WHERE ') + 'card_id = $accountNumber';
        params.accountNumber = input.accountNumber;
      }
      
      cardQuery += ' ORDER BY date DESC, card_id';
      
      if (input.limit) {
        cardQuery += ` LIMIT $limit`;
        params.limit = input.accountType === 'all' ? Math.ceil(input.limit / 2) : input.limit;
      }
      
      const cardTransactions = db.prepare(cardQuery).all(params);
      transactions.push(...cardTransactions);
    }
    
    // Sort all transactions by date descending
    transactions.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB.getTime() - dateA.getTime();
    });
    
    // Apply global limit if needed
    const finalTransactions = input.limit ? transactions.slice(0, input.limit) : transactions;
    
    // Get summary statistics
    const totalAmount = finalTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const accountSummary = finalTransactions.reduce((acc: any, t) => {
      const key = t.account_number;
      if (!acc[key]) {
        acc[key] = { 
          account_number: key, 
          account_type: t.account_type,
          transaction_count: 0, 
          total_amount: 0,
          currency: t.currency 
        };
      }
      acc[key].transaction_count++;
      acc[key].total_amount += t.amount || 0;
      return acc;
    }, {});
    
    db.close();
    
    return {
      ok: true,
      data: {
        transactions: finalTransactions,
        summary: {
          total_transactions: finalTransactions.length,
          total_amount: totalAmount,
          date_range: {
            from: input.fromDate || 'all',
            to: input.toDate || 'all'
          },
          accounts: Object.values(accountSummary)
        }
      },
      source: {
        database: 'sqlite/finance.db',
        tables: ['silver_bank_transactions', 'silver_creditcard_transactions'],
        duration_ms: Date.now() - startTime,
      },
    };
    
  } catch (error) {
    return createApiError(
      500,
      'DATABASE_ERROR',
      error instanceof Error ? error.message : 'Failed to fetch bank transactions',
      {
        suggestion: 'Check if the SQLite database exists and contains bank transaction data',
        example: 'Ensure bank data has been synced: node Bank/fetch-raw.js && node Bank/parse-raw.js'
      }
    );
  }
}

export const getBankTransactionsTool = {
  name: 'bank_get_bank_transactions',
  description: 'Get bank account and credit card transactions from local SQLite database. Returns transaction history with dates, descriptions, amounts, and account details.',
  inputSchema: getBankTransactionsSchema,
  handler: getBankTransactions,
};