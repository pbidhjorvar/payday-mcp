import axios, { AxiosInstance } from 'axios';
import { Profile } from '../config/profiles.js';
import { AuthClient } from '../auth/authClient.js';
import { mapHttpError, ApiError } from './errors.js';
import { logger } from '../util/logger.js';

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
}

export class PaydayClient {
  private client: AxiosInstance;
  private authClient: AuthClient;
  private profileName: string;
  private profile: Profile;
  private lastRateLimit: RateLimitInfo | null = null;

  constructor(
    profileName: string,
    profile: Profile,
    authClient: AuthClient
  ) {
    this.profileName = profileName;
    this.profile = profile;
    this.authClient = authClient;
    
    this.client = axios.create({
      baseURL: profile.base_url,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(async (config) => {
      const token = await this.authClient.getToken(this.profileName, this.profile);
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    // Response interceptor for rate limit headers
    this.client.interceptors.response.use(
      (response) => {
        this.extractRateLimitHeaders(response.headers);
        return response;
      },
      (error) => {
        if (error.response) {
          this.extractRateLimitHeaders(error.response.headers);
        }
        return Promise.reject(error);
      }
    );
  }

  private extractRateLimitHeaders(headers: any): void {
    const limit = headers['x-ratelimit-limit'];
    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];

    if (limit && remaining && reset) {
      this.lastRateLimit = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10),
      };
    }
  }

  getRateLimitInfo(): RateLimitInfo | null {
    return this.lastRateLimit;
  }

  async get<T = any>(
    path: string,
    params?: Record<string, any>
  ): Promise<T | ApiError> {
    const startTime = Date.now();
    let retryCount = 0;

    const makeRequest = async (): Promise<T | ApiError> => {
      try {
        // Process params - convert arrays to comma-separated strings
        const processedParams = params ? { ...params } : {};
        for (const key in processedParams) {
          if (Array.isArray(processedParams[key])) {
            processedParams[key] = processedParams[key].join(',');
          }
        }

        const response = await this.client.get<T>(path, {
          params: processedParams,
        });

        const duration = Date.now() - startTime;
        logger.info(`GET ${path}`, {
          duration_ms: duration,
          status: response.status,
        });

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          const { status, data } = error.response;

          // Auto-refresh on 401 (once per call)
          if (status === 401 && retryCount === 0) {
            retryCount++;
            logger.info('Token expired, refreshing...');
            this.authClient.clearCache(this.profileName);
            return makeRequest();
          }

          const duration = Date.now() - startTime;
          logger.error(`GET ${path} failed`, {
            duration_ms: duration,
            status,
            error: data?.message || error.message,
          });

          return mapHttpError(status, data);
        }

        // Network or other errors
        const duration = Date.now() - startTime;
        logger.error(`GET ${path} failed`, {
          duration_ms: duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        return mapHttpError(0, {
          message: error instanceof Error ? error.message : 'Network error',
        });
      }
    };

    return makeRequest();
  }

  async put<T = any>(
    path: string,
    data?: any
  ): Promise<T | ApiError> {
    if (this.profile.read_only) {
      return {
        ok: false,
        error: {
          status: 403,
          label: 'READ_ONLY_MODE',
          detail: 'PUT operations are not allowed in read-only mode',
        },
      } as ApiError;
    }

    const startTime = Date.now();
    let retryCount = 0;

    const makeRequest = async (): Promise<T | ApiError> => {
      try {
        const response = await this.client.put<T>(path, data);

        const duration = Date.now() - startTime;
        logger.info(`PUT ${path}`, {
          duration_ms: duration,
          status: response.status,
        });

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          const { status, data } = error.response;

          // Auto-refresh on 401 (once per call)
          if (status === 401 && retryCount === 0) {
            retryCount++;
            logger.info('Token expired, refreshing...');
            this.authClient.clearCache(this.profileName);
            return makeRequest();
          }

          const duration = Date.now() - startTime;
          logger.error(`PUT ${path} failed`, {
            duration_ms: duration,
            status,
            error: data?.message || error.message,
          });

          return mapHttpError(status, data);
        }

        // Network or other errors
        const duration = Date.now() - startTime;
        logger.error(`PUT ${path} failed`, {
          duration_ms: duration,
          error: error instanceof Error ? error.message : 'Network error',
        });

        return mapHttpError(0, {
          message: error instanceof Error ? error.message : 'Network error',
        });
      }
    };

    return makeRequest();
  }

  async post<T = any>(
    path: string,
    data?: any
  ): Promise<T | ApiError> {
    if (this.profile.read_only) {
      return {
        ok: false,
        error: {
          status: 403,
          label: 'READ_ONLY_MODE',
          detail: 'POST operations are not allowed in read-only mode',
        },
      } as ApiError;
    }

    const startTime = Date.now();
    let retryCount = 0;

    const makeRequest = async (): Promise<T | ApiError> => {
      try {
        const response = await this.client.post<T>(path, data);

        const duration = Date.now() - startTime;
        logger.info(`POST ${path}`, {
          duration_ms: duration,
          status: response.status,
        });

        return response.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          const { status, data } = error.response;

          // Auto-refresh on 401 (once per call)
          if (status === 401 && retryCount === 0) {
            retryCount++;
            logger.info('Token expired, refreshing...');
            this.authClient.clearCache(this.profileName);
            return makeRequest();
          }

          const duration = Date.now() - startTime;
          logger.error(`POST ${path} failed`, {
            duration_ms: duration,
            status,
            error: data?.message || error.message,
          });

          return mapHttpError(status, data);
        }

        // Network or other errors
        const duration = Date.now() - startTime;
        logger.error(`POST ${path} failed`, {
          duration_ms: duration,
          error: error instanceof Error ? error.message : 'Network error',
        });

        return mapHttpError(0, {
          message: error instanceof Error ? error.message : 'Network error',
        });
      }
    };

    return makeRequest();
  }
}