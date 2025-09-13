#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { loadEnv } from './config/env.js';
import { loadProfiles, getProfile } from './config/profiles.js';
import { AuthClient } from './auth/authClient.js';
import { PaydayClient } from './http/paydayClient.js';

// Import tools
import { showProfileTool, healthcheckTool, rateLimitStatusTool } from './tools/meta.js';
import { getCustomersTool, getCustomerTool } from './tools/customers.js';
import { getInvoicesTool, getInvoiceTool, updateInvoiceTool } from './tools/invoices.js';
import { getExpensesTool, getExpenseAccountsTool, getExpensePaymentTypesTool } from './tools/expenses.js';
import { getPaymentTypesTool } from './tools/payment-types.js';
import { getPaymentsTool } from './tools/payments.js';
import { getCompanyTool } from './tools/company.js';
import { getAccountsTool, getAccountStatementTool } from './tools/accounting.js';
import { getSalesOrdersTool } from './tools/salesorders.js';
import { createJournalEntryTool, updateJournalEntryTool, getJournalEntriesTool } from './tools/journal.js';
import { getBankTransactionsTool } from './tools/bank-transactions.js';
import { sqlite_list_objects, sqlite_table_info, sqlite_explain, sqlite_sql_select } from './tools/sqlite_sql.js';

// Initialize configuration
const env = loadEnv();
const profiles = loadProfiles();
const currentProfileName = env.defaultProfile;
const currentProfile = getProfile(currentProfileName, profiles);

// Initialize clients
const authClient = new AuthClient(env);
const paydayClient = new PaydayClient(currentProfileName, currentProfile, authClient);

// Tool registry
const tools = [
  // Payday API tools
  showProfileTool,
  healthcheckTool,
  rateLimitStatusTool,
  getCompanyTool,
  getAccountsTool,
  getAccountStatementTool,
  getCustomersTool,
  getCustomerTool,
  getInvoicesTool,
  getInvoiceTool,
  updateInvoiceTool,
  getExpensesTool,
  getExpenseAccountsTool,
  getExpensePaymentTypesTool,
  getPaymentTypesTool,
  getSalesOrdersTool,
  getPaymentsTool,
  createJournalEntryTool,
  updateJournalEntryTool,
  getJournalEntriesTool,
  // Bank transaction tools
  getBankTransactionsTool,
  // SQLite SQL tools (no Payday client needed)
  sqlite_list_objects,
  sqlite_table_info,
  sqlite_explain,
  sqlite_sql_select,
];

// Initialize MCP server
const server = new Server(
  {
    name: 'payday-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((tool) => {
      const schemaResult = getSchemaProperties(tool.inputSchema);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties: schemaResult.properties,
          required: schemaResult.required,
          additionalProperties: false,
        },
      };
    }),
  };
});

// Helper function to convert Zod schema to JSON Schema properties
function getSchemaProperties(zodSchema: any): { properties: any; required: string[] } {
  const shape = zodSchema._def?.shape;
  if (!shape) return { properties: {}, required: [] };
  
  const properties: any = {};
  const required: string[] = [];
  
  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as any;
    properties[key] = zodTypeToJsonSchema(zodType);
    
    // Check if field is required (not optional)
    if (zodType._def?.typeName !== 'ZodOptional') {
      required.push(key);
    }
  }
  
  return { properties, required };
}

function zodTypeToJsonSchema(zodType: any): any {
  const typeName = zodType._def?.typeName;
  const description = zodType._def?.description;
  
  let schema: any;
  
  switch (typeName) {
    case 'ZodString':
      schema = { type: 'string' };
      break;
    case 'ZodNumber':
      schema = { type: 'number' };
      break;
    case 'ZodBoolean':
      schema = { type: 'boolean' };
      break;
    case 'ZodOptional':
      return zodTypeToJsonSchema(zodType._def.innerType);
    case 'ZodArray':
      schema = {
        type: 'array',
        items: zodTypeToJsonSchema(zodType._def.type),
      };
      break;
    case 'ZodObject':
      const shape = zodType._def?.shape;
      if (!shape) {
        schema = { type: 'object' };
        break;
      }
      
      const properties: any = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodTypeToJsonSchema(value as any);
        const valueType = value as any;
        if (valueType._def?.typeName !== 'ZodOptional') {
          required.push(key);
        }
      }
      
      schema = {
        type: 'object',
        properties,
        additionalProperties: false,
      };
      if (required.length > 0) {
        schema.required = required;
      }
      break;
    case 'ZodRefined':
      // Handle refined schemas (like our journal line validation)
      return zodTypeToJsonSchema(zodType._def.schema);
    case 'ZodEnum':
      schema = {
        type: 'string',
        enum: zodType._def.values,
      };
      break;
    case 'ZodUnion':
      // Handle union types
      schema = {
        oneOf: zodType._def.options.map((option: any) => zodTypeToJsonSchema(option)),
      };
      break;
    default:
      schema = { type: 'string' };
  }
  
  // Add description if present
  if (description) {
    schema.description = description;
  }
  
  return schema;
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: `Unknown tool: ${name}`,
          }, null, 2),
        },
      ],
    };
  }

  try {
    // Debug logging for journal entry tool (only when DEBUG=1)
    if (process.env.DEBUG === '1' && name === 'payday_create_journal_entry' && args) {
      console.error('[DEBUG] Journal entry args type:', typeof args);
      console.error('[DEBUG] Lines type:', typeof (args as any).lines);
      if ((args as any).lines) {
        console.error('[DEBUG] Is lines array?:', Array.isArray((args as any).lines));
        console.error('[DEBUG] Lines count:', Array.isArray((args as any).lines) ? (args as any).lines.length : 'N/A');
      }
    }
    
    // Handle potential string-encoded JSON in parameters
    let processedArgs = { ...(args || {}) };
    
    // Check if lines is a string that needs to be parsed as JSON
    if (name === 'payday_create_journal_entry' && typeof processedArgs.lines === 'string') {
      try {
        if (process.env.DEBUG === '1') {
          console.error('[DEBUG] Attempting to parse lines as JSON string...');
        }
        processedArgs.lines = JSON.parse(processedArgs.lines);
        if (process.env.DEBUG === '1') {
          console.error('[DEBUG] Successfully parsed lines count:', Array.isArray(processedArgs.lines) ? processedArgs.lines.length : 'N/A');
        }
      } catch (e: any) {
        if (process.env.DEBUG === '1') {
          console.error('[DEBUG] Failed to parse lines as JSON:', e.message);
        }
      }
    }
    
    // For all tools, check if any parameter that should be an array/object is actually a string
    for (const [key, value] of Object.entries(processedArgs)) {
      if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
        try {
          processedArgs[key] = JSON.parse(value);
          if (process.env.DEBUG === '1') {
            console.error(`[DEBUG] Parsed ${key} from JSON string`);
          }
        } catch (e) {
          // Keep as string if parse fails
        }
      }
    }
    
    // Special validation to catch underscore parameter mistakes (Payday uses camelCase)
    if (name === 'payday_update_invoice' || name === 'payday_get_invoices' || name === 'payday_get_invoice' || name === 'payday_get_customer') {
      if (process.env.DEBUG === '1') {
        console.error('[DEBUG] Invoice/customer tool args keys:', Object.keys(processedArgs));
      }
      const argKeys = Object.keys(processedArgs);
      
      if (argKeys.includes('invoice_id')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: {
                  status: 400,
                  label: 'PARAMETER_ERROR',
                  detail: 'Use "invoiceId" not "invoice_id". No underscores in Payday parameter names.',
                },
              }, null, 2),
            },
          ],
        };
      }
      
      if (argKeys.includes('action')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: {
                  status: 400,
                  label: 'PARAMETER_ERROR',
                  detail: 'Use "mode" not "action". Available modes: mark_as_paid, cancel_invoice, resend_email.',
                },
              }, null, 2),
            },
          ],
        };
      }
      
      if (argKeys.includes('paid_date') || argKeys.includes('payment_date')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: {
                  status: 400,
                  label: 'PARAMETER_ERROR',
                  detail: 'Use "paidDate" not "paid_date" or "payment_date". Format: YYYY-MM-DD (e.g., "2024-12-18"). Also required: "paymentType" (get UUID from payment-types-list tool).',
                },
              }, null, 2),
            },
          ],
        };
      }
      
      if (argKeys.includes('customer_id')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: {
                  status: 400,
                  label: 'PARAMETER_ERROR',
                  detail: 'Use "customerId" not "customer_id". No underscores in Payday parameter names.',
                },
              }, null, 2),
            },
          ],
        };
      }
    }
    
    // Validate input
    const validatedInput = tool.inputSchema.parse(processedArgs);
    
    // Execute tool (all tools now use the same signature)
    const result = await tool.handler(
      validatedInput,
      currentProfileName,
      currentProfile,
      paydayClient
    );
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: {
                status: 400,
                label: 'VALIDATION_ERROR',
                detail: 'Invalid input',
                fields: error.flatten().fieldErrors,
              },
            }, null, 2),
          },
        ],
      };
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: {
              status: 500,
              label: 'UNKNOWN_ERROR',
              detail: error instanceof Error ? error.message : 'Unknown error',
            },
          }, null, 2),
        },
      ],
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Payday MCP server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});