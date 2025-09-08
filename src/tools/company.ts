import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getCompanySchema } from '../types/schemas.js';

export const getCompanyTool = {
  name: 'payday_get_company',
  description: 'Get current company information',
  inputSchema: getCompanySchema,
  handler: async (
    _input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const startTime = Date.now();
    const result = await client.get('/companies/me');
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: '/companies/me',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};