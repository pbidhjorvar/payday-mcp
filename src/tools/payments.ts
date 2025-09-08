import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getPaymentsSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const getPaymentsTool = {
  name: 'payday_get_payments',
  description: 'Get payments with optional date filtering',
  inputSchema: getPaymentsSchema,
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

    const startTime = Date.now();
    const result = await client.get('/payments', params);
    
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
        endpoint: '/payments',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};