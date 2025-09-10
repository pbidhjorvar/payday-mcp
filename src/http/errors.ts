export interface ApiError {
  ok: false;
  error: {
    status: number;
    label: string;
    detail: string;
    suggestion?: string;
    example?: string;
    fields?: Record<string, string[]>;
  };
}

export function createApiError(
  status: number,
  label: string,
  detail: string,
  options?: {
    fields?: Record<string, string[]>;
    suggestion?: string;
    example?: string;
  }
): ApiError {
  return {
    ok: false,
    error: {
      status,
      label,
      detail,
      suggestion: options?.suggestion,
      example: options?.example,
      fields: options?.fields,
    },
  };
}

export function mapHttpError(status: number, data?: any): ApiError {
  // Extract field errors if present
  const fields = data?.errors || data?.fields;
  
  switch (status) {
    case 400:
    case 422:
      return createApiError(
        status,
        'VALIDATION_ERROR',
        data?.message || data?.detail || 'Invalid request data',
        {
          fields,
          suggestion: 'Check the required parameters and data types',
          example: 'Use valid date format: YYYY-MM-DD (e.g., "2025-01-15")'
        }
      );
    
    case 401:
      return createApiError(
        status,
        'AUTH_FAILED',
        data?.message || data?.detail || 'Authentication failed',
        {
          suggestion: 'Check your CLIENT_ID and CLIENT_SECRET in .env file',
          example: 'Ensure credentials are valid and not expired'
        }
      );
    
    case 403:
      return createApiError(
        status,
        'AUTH_FAILED',
        data?.message || data?.detail || 'Forbidden'
      );
    
    case 404:
      return createApiError(
        status,
        'NOT_FOUND',
        data?.message || data?.detail || 'Resource not found',
        {
          suggestion: 'Verify the ID exists and you have access to it',
          example: 'Use list endpoints to find valid IDs'
        }
      );
    
    case 429:
      return createApiError(
        status,
        'RATE_LIMITED',
        data?.message || data?.detail || 'Rate limit exceeded',
        {
          suggestion: 'Wait before making more requests or reduce request frequency',
          example: 'Current rate limit will reset in a few minutes'
        }
      );
    
    default:
      if (status >= 500) {
        return createApiError(
          status,
          'SERVER_ERROR',
          data?.message || data?.detail || 'Internal server error'
        );
      }
      return createApiError(
        status,
        'UNKNOWN_ERROR',
        data?.message || data?.detail || `HTTP ${status} error`
      );
  }
}