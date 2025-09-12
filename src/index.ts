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
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object',
        properties: getSchemaProperties(tool.inputSchema),
        additionalProperties: false,
      },
    })),
  };
});

// Helper function to convert Zod schema to JSON Schema properties
function getSchemaProperties(zodSchema: any): any {
  const shape = zodSchema._def?.shape;
  if (!shape) return {};
  
  const properties: any = {};
  
  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as any;
    properties[key] = zodTypeToJsonSchema(zodType);
  }
  
  return properties;
}

function zodTypeToJsonSchema(zodType: any): any {
  const typeName = zodType._def?.typeName;
  
  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodOptional':
      return zodTypeToJsonSchema(zodType._def.innerType);
    case 'ZodArray':
      return {
        type: 'array',
        items: zodTypeToJsonSchema(zodType._def.type),
      };
    case 'ZodObject':
      const shape = zodType._def?.shape;
      if (!shape) return { type: 'object' };
      
      const properties: any = {};
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodTypeToJsonSchema(value as any);
      }
      
      return {
        type: 'object',
        properties,
        additionalProperties: false,
      };
    case 'ZodRefined':
      // Handle refined schemas (like our journal line validation)
      return zodTypeToJsonSchema(zodType._def.schema);
    case 'ZodEnum':
      return {
        type: 'string',
        enum: zodType._def.values,
      };
    case 'ZodUnion':
      // Handle union types
      return {
        oneOf: zodType._def.options.map((option: any) => zodTypeToJsonSchema(option)),
      };
    default:
      return { type: 'string' };
  }
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
    // Debug logging for journal entry tool
    if (name === 'payday_create_journal_entry' && args) {
      console.error('[DEBUG] Raw args received:', JSON.stringify(args, null, 2));
      console.error('[DEBUG] Type of args:', typeof args);
      console.error('[DEBUG] Type of args.lines:', typeof (args as any).lines);
      if ((args as any).lines) {
        console.error('[DEBUG] Is args.lines an array?:', Array.isArray((args as any).lines));
        console.error('[DEBUG] args.lines value:', (args as any).lines);
      }
    }
    
    // Handle potential string-encoded JSON in parameters
    let processedArgs = { ...(args || {}) };
    
    // Check if lines is a string that needs to be parsed as JSON
    if (name === 'payday_create_journal_entry' && typeof processedArgs.lines === 'string') {
      try {
        console.error('[DEBUG] Attempting to parse lines as JSON string...');
        processedArgs.lines = JSON.parse(processedArgs.lines);
        console.error('[DEBUG] Successfully parsed lines:', processedArgs.lines);
      } catch (e: any) {
        console.error('[DEBUG] Failed to parse lines as JSON:', e.message);
      }
    }
    
    // For all tools, check if any parameter that should be an array/object is actually a string
    for (const [key, value] of Object.entries(processedArgs)) {
      if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
        try {
          processedArgs[key] = JSON.parse(value);
          console.error(`[DEBUG] Parsed ${key} from JSON string`);
        } catch (e) {
          // Keep as string if parse fails
        }
      }
    }
    
    // Special validation for invoice update tool to catch common parameter mistakes
    if (name === 'payday_update_invoice') {
      console.error('[DEBUG] Invoice update args received:', JSON.stringify(processedArgs, null, 2));
      const argKeys = Object.keys(processedArgs);
      console.error('[DEBUG] Parameter keys:', argKeys);
      
      if (argKeys.includes('invoiceId')) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: {
                  status: 400,
                  label: 'PARAMETER_ERROR',
                  detail: 'Use "invoice_id" not "invoiceId". Check the documentation for correct parameter names.',
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
                  detail: 'Use "paidDate" not "paid_date" or "payment_date". Format: YYYY-MM-DD (e.g., "2024-12-18").',
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