import { z } from 'zod';
import { PaydayClient } from '../http/paydayClient.js';
import { getPaymentTypesSchema } from '../types/schemas.js';
import { Profile } from '../config/profiles.js';

export async function getPaymentTypes(
  _input: z.infer<typeof getPaymentTypesSchema>,
  _profileName: string,
  _profile: Profile,
  client: PaydayClient
) {
  try {
    const result = await client.getPaymentTypes();
    
    if ('ok' in result && !result.ok) {
      return result;
    }

    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to fetch payment types',
    };
  }
}

export const getPaymentTypesTool = {
  name: 'payment-types-list',
  description: 'List all payment types (bank accounts) configured in Payday',
  inputSchema: getPaymentTypesSchema,
  handler: getPaymentTypes,
};