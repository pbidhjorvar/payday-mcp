import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getExpensesSchema, getExpenseAccountsSchema, getExpensePaymentTypesSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const getExpensesTool = {
  name: 'payday_get_expenses',
  description: 'Get expenses with optional filtering',
  inputSchema: getExpensesSchema,
  handler: async (
    input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const { page, perpage } = validatePagination({
      page: input.page,
      perpage: input.perpage ?? 100,
    });

    const params: Record<string, any> = { page, perpage };
    
    // Add optional filters
    if (input.from) params.from = input.from;
    if (input.to) params.to = input.to;
    if (input.query) params.query = input.query;
    if (input.include && input.include.length > 0) {
      params.include = input.include;
    }

    const startTime = Date.now();
    const result = await client.get('/expenses', params);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;
    const meta = buildPaginationMeta(result, page, perpage);

    return {
      ok: true,
      data,
      ...(meta && { page: meta }),
      source: {
        endpoint: '/expenses',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const getExpenseAccountsTool = {
  name: 'payday_get_expense_accounts',
  description: 'Get available expense accounts',
  inputSchema: getExpenseAccountsSchema,
  handler: async (
    _input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const startTime = Date.now();
    const result = await client.get('/expenses/accounts');
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: '/expenses/accounts',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const getExpensePaymentTypesTool = {
  name: 'payday_get_expense_payment_types',
  description: 'Get available expense payment types',
  inputSchema: getExpensePaymentTypesSchema,
  handler: async (
    _input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const startTime = Date.now();
    const result = await client.get('/expenses/paymenttypes');
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: '/expenses/paymenttypes',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};