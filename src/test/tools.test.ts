import { describe, it, expect, vi } from 'vitest';
import { showProfileTool, healthcheckTool } from '../tools/meta.js';
import { getCustomersTool } from '../tools/customers.js';

describe('Tools', () => {
  const mockProfile = {
    base_url: 'https://api.test.payday.is',
    company_id: 'comp123',
    read_only: true,
  };

  describe('showProfileTool', () => {
    it('should return profile information', async () => {
      const mockClient = {} as any;
      
      const result = await showProfileTool.handler(
        {},
        'test',
        mockProfile,
        mockClient
      );

      expect(result).toEqual({
        ok: true,
        data: {
          profile_name: 'test',
          base_url: 'https://api.test.payday.is',
          company_id: 'comp123',
          read_only: true,
        },
      });
    });
  });

  describe('healthcheckTool', () => {
    it('should return healthy status on success', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({ data: [] }),
      } as any;

      const result = await healthcheckTool.handler(
        {},
        'test',
        mockProfile,
        mockClient
      );

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        status: 'healthy',
        authenticated: true,
      });
      expect(mockClient.get).toHaveBeenCalledWith('/customers', {
        page: 1,
        perpage: 1,
      });
    });

    it('should return error on failure', async () => {
      const mockError = {
        ok: false,
        error: {
          status: 401,
          label: 'AUTH_FAILED',
          detail: 'Token expired',
        },
      };

      const mockClient = {
        get: vi.fn().mockResolvedValue(mockError),
      } as any;

      const result = await healthcheckTool.handler(
        {},
        'test',
        mockProfile,
        mockClient
      );

      expect(result).toEqual(mockError);
    });
  });

  describe('getCustomersTool', () => {
    it('should fetch customers with default pagination', async () => {
      const mockResponse = {
        data: [
          { id: '1', name: 'Customer 1' },
          { id: '2', name: 'Customer 2' },
        ],
        meta: {
          current_page: 1,
          per_page: 50,
          total: 100,
          last_page: 2,
        },
      };

      const mockClient = {
        get: vi.fn().mockResolvedValue(mockResponse),
      } as any;

      const result = await getCustomersTool.handler(
        {},
        'test',
        mockProfile,
        mockClient
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(result.page).toEqual({
        page: 1,
        perpage: 50,
        total: 100,
        has_next: true,
      });
      expect(mockClient.get).toHaveBeenCalledWith('/customers', {
        page: 1,
        perpage: 50,
      });
    });

    it('should apply query parameter', async () => {
      const mockResponse = {
        data: [],
        meta: {
          current_page: 1,
          per_page: 50,
          total: 0,
          last_page: 1,
        },
      };

      const mockClient = {
        get: vi.fn().mockResolvedValue(mockResponse),
      } as any;

      await getCustomersTool.handler(
        { query: 'test search' },
        'test',
        mockProfile,
        mockClient
      );

      expect(mockClient.get).toHaveBeenCalledWith('/customers', {
        page: 1,
        perpage: 50,
        query: 'test search',
      });
    });

    it('should handle API errors', async () => {
      const mockError = {
        ok: false,
        error: {
          status: 500,
          label: 'SERVER_ERROR',
          detail: 'Internal server error',
        },
      };

      const mockClient = {
        get: vi.fn().mockResolvedValue(mockError),
      } as any;

      const result = await getCustomersTool.handler(
        {},
        'test',
        mockProfile,
        mockClient
      );

      expect(result).toEqual(mockError);
    });
  });
});