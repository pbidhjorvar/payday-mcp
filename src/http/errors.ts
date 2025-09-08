export interface ApiError {
  ok: false;
  error: {
    status: number;
    label: string;
    detail: string;
    fields?: Record<string, string[]>;
  };
}

export function createApiError(
  status: number,
  label: string,
  detail: string,
  fields?: Record<string, string[]>
): ApiError {
  return {
    ok: false,
    error: {
      status,
      label,
      detail,
      fields,
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
        fields
      );
    
    case 401:
      return createApiError(
        status,
        'AUTH_FAILED',
        data?.message || data?.detail || 'Token expired'
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
        data?.message || data?.detail || 'Resource not found'
      );
    
    case 429:
      return createApiError(
        status,
        'RATE_LIMITED',
        data?.message || data?.detail || 'Too many requests'
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