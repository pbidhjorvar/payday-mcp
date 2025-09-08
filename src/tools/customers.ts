import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getCustomersSchema, getCustomerSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const getCustomersTool = {
  name: 'payday_get_customers',
  description: 'Get list of customers with pagination',
  inputSchema: getCustomersSchema,
  handler: async (
    input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const { page, perpage } = validatePagination({
      page: input.page,
      perpage: input.perpage ?? 50,
    });

    const params: Record<string, any> = { page, perpage };
    if (input.query) {
      params.query = input.query;
    }

    const startTime = Date.now();
    const result = await client.get('/customers', params);
    
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
        endpoint: '/customers',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const getCustomerTool = {
  name: 'payday_get_customer',
  description: 'Get a specific customer by ID',
  inputSchema: getCustomerSchema,
  handler: async (
    input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const startTime = Date.now();
    const result = await client.get(`/customers/${input.customer_id}`);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: `/customers/${input.customer_id}`,
        duration_ms: Date.now() - startTime,
      },
    };
  },
};