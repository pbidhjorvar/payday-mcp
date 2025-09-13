import { z } from 'zod';
import { PaydayClient } from '../http/paydayClient.js';
import { getPaymentTypesSchema } from '../types/schemas.js';
import { Profile } from '../config/profiles.js';
import { createApiError } from '../http/errors.js';

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
    return createApiError(
      500,
      'UNKNOWN_ERROR',
      error instanceof Error ? error.message : 'Failed to fetch payment types'
    );
  }
}

export const getPaymentTypesTool = {
  name: 'payday_get_payment_types',
  description: 'List all payment types (bank accounts) configured in Payday',
  inputSchema: getPaymentTypesSchema,
  handler: getPaymentTypes,
};