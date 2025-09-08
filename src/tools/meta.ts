import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { showProfileSchema, healthcheckSchema, rateLimitStatusSchema } from '../types/schemas.js';

export const showProfileTool = {
  name: 'payday_show_profile',
  description: 'Show current profile configuration',
  inputSchema: showProfileSchema,
  handler: async (
    _input: any,
    profileName: string,
    profile: Profile,
    _client: PaydayClient
  ) => {
    return {
      ok: true,
      data: {
        profile_name: profileName,
        base_url: profile.base_url,
        company_id: profile.company_id,
        read_only: profile.read_only,
      },
    };
  },
};

export const healthcheckTool = {
  name: 'payday_healthcheck',
  description: 'Verify API connectivity and authentication',
  inputSchema: healthcheckSchema,
  handler: async (
    _input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const startTime = Date.now();
    const result = await client.get('/customers', { page: 1, perpage: 1 });
    
    if ('error' in result) {
      return result;
    }
    
    return {
      ok: true,
      data: {
        status: 'healthy',
        authenticated: true,
        response_time_ms: Date.now() - startTime,
      },
    };
  },
};

export const rateLimitStatusTool = {
  name: 'payday_rate_limit_status',
  description: 'Get current rate limit status from last API call',
  inputSchema: rateLimitStatusSchema,
  handler: async (
    _input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const rateLimit = client.getRateLimitInfo();
    
    if (!rateLimit) {
      return {
        ok: true,
        data: {
          message: 'No rate limit information available',
        },
      };
    }
    
    return {
      ok: true,
      data: {
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        reset: rateLimit.reset,
        reset_date: new Date(rateLimit.reset * 1000).toISOString(),
      },
    };
  },
};