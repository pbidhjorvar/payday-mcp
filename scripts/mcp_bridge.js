#!/usr/bin/env node

/**
 * Node.js bridge to expose Payday-MCP tools for Python data pipeline
 * Usage: node scripts/mcp_bridge.js <tool_name> [args_json]
 */

import { loadEnv } from '../dist/config/env.js';
import { loadProfiles, getProfile } from '../dist/config/profiles.js';
import { AuthClient } from '../dist/auth/authClient.js';
import { PaydayClient } from '../dist/http/paydayClient.js';

// Import tools
import { getAccountsTool, getAccountStatementTool } from '../dist/tools/accounting.js';
import { getCustomersTool, getCustomerTool } from '../dist/tools/customers.js';
import { getInvoicesTool, getInvoiceTool } from '../dist/tools/invoices.js';
import { getPaymentsTool } from '../dist/tools/payments.js';
import { getCompanyTool } from '../dist/tools/company.js';
import { getExpensesTool, getExpenseAccountsTool, getExpensePaymentTypesTool } from '../dist/tools/expenses.js';

async function main() {
  try {
    const toolName = process.argv[2];
    const argsJson = process.argv[3] || '{}';
    
    if (!toolName) {
      console.error('Usage: node mcp_bridge.js <tool_name> [args_json]');
      process.exit(1);
    }

    // Initialize configuration
    const env = loadEnv();
    const profiles = loadProfiles();
    const currentProfileName = env.defaultProfile;
    const currentProfile = getProfile(currentProfileName, profiles);

    // Initialize clients
    const authClient = new AuthClient(env);
    const paydayClient = new PaydayClient(currentProfileName, currentProfile, authClient);

    // Tool registry
    const tools = {
      'payday_get_accounts': getAccountsTool,
      'payday_get_account_statement': getAccountStatementTool,
      'payday_get_customers': getCustomersTool,
      'payday_get_customer': getCustomerTool,
      'payday_get_invoices': getInvoicesTool,
      'payday_get_invoice': getInvoiceTool,
      'payday_get_payments': getPaymentsTool,
      'payday_get_company': getCompanyTool,
      'payday_get_expenses': getExpensesTool,
      'payday_get_expense_accounts': getExpenseAccountsTool,
      'payday_get_expense_payment_types': getExpensePaymentTypesTool,
    };

    const tool = tools[toolName];
    if (!tool) {
      console.error(`Unknown tool: ${toolName}`);
      console.error(`Available tools: ${Object.keys(tools).join(', ')}`);
      process.exit(1);
    }

    // Parse arguments
    let args;
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error(`Invalid JSON arguments: ${argsJson}`);
      process.exit(1);
    }

    // Execute tool
    const result = await tool.handler(
      args,
      currentProfileName,
      currentProfile,
      paydayClient
    );

    // Output result as JSON
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();