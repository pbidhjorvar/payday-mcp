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
    case 'ZodOptional':
      return zodTypeToJsonSchema(zodType._def.innerType);
    case 'ZodArray':
      return {
        type: 'array',
        items: zodTypeToJsonSchema(zodType._def.type),
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
    // Validate input
    const validatedInput = tool.inputSchema.parse(args);
    
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