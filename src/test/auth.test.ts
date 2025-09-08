import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { AuthClient } from '../auth/authClient.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('AuthClient', () => {
  let authClient: AuthClient;
  const mockEnv = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    defaultProfile: 'test',
  };
  const mockProfile = {
    base_url: 'https://api.test.payday.is',
    company_id: null,
    read_only: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authClient = new AuthClient(mockEnv);
  });

  describe('getToken', () => {
    it('should fetch a new token when cache is empty', async () => {
      const mockResponse = {
        data: {
          accessToken: 'test-access-token',
          expiresIn: 3600,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const token = await authClient.getToken('test', mockProfile);

      expect(token).toBe('test-access-token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.test.payday.is/auth/token',
        {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    });

    it('should return cached token when not expired', async () => {
      const mockResponse = {
        data: {
          accessToken: 'cached-token',
          expiresIn: 3600,
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      // First call - fetch token
      const token1 = await authClient.getToken('test', mockProfile);
      // Second call - should use cache
      const token2 = await authClient.getToken('test', mockProfile);

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('should refresh token when expired', async () => {
      const mockResponse1 = {
        data: {
          accessToken: 'expired-token',
          expiresIn: -1, // Already expired
        },
      };

      const mockResponse2 = {
        data: {
          accessToken: 'new-token',
          expiresIn: 3600,
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const token1 = await authClient.getToken('test', mockProfile);
      const token2 = await authClient.getToken('test', mockProfile);

      expect(token1).toBe('expired-token');
      expect(token2).toBe('new-token');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('refreshToken', () => {
    it('should handle auth errors', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          data: {
            error: 'invalid_client',
          },
        },
        message: 'Request failed',
      };
      
      // Mock axios.isAxiosError to return true for our error
      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      mockedAxios.post.mockRejectedValueOnce(axiosError);

      await expect(authClient.refreshToken('test', mockProfile)).rejects.toThrow(
        'Auth failed: invalid_client'
      );
    });
  });

  describe('clearCache', () => {
    it('should clear specific profile cache', async () => {
      const mockResponse = {
        data: {
          accessToken: 'test-token',
          expiresIn: 3600,
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      await authClient.getToken('test', mockProfile);
      authClient.clearCache('test');
      await authClient.getToken('test', mockProfile);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache when no profile specified', async () => {
      const mockResponse = {
        data: {
          accessToken: 'test-token',
          expiresIn: 3600,
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      await authClient.getToken('test', mockProfile);
      authClient.clearCache();
      await authClient.getToken('test', mockProfile);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });
});