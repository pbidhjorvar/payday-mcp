import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getSalesOrdersSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const getSalesOrdersTool = {
  name: 'payday_get_sales_orders',
  description: 'Get sales orders with optional line items',
  inputSchema: getSalesOrdersSchema,
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
    
    if (input.include && input.include.length > 0) {
      params.include = input.include;
    }

    const startTime = Date.now();
    const result = await client.get('/salesorders', params);
    
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
        endpoint: '/salesorders',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};