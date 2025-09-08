import axios from 'axios';
import { Profile } from '../config/profiles.js';
import { EnvConfig } from '../config/env.js';

export interface TokenData {
  access_token: string;
  expires_at: number; // Unix timestamp in ms
}

export class AuthClient {
  private tokenCache = new Map<string, TokenData>();
  private env: EnvConfig;

  constructor(env: EnvConfig) {
    this.env = env;
  }

  async getToken(profileName: string, profile: Profile): Promise<string> {
    const cached = this.tokenCache.get(profileName);
    
    // Check if we have a valid cached token
    if (cached && cached.expires_at > Date.now()) {
      return cached.access_token;
    }
    
    // Refresh the token
    return this.refreshToken(profileName, profile);
  }

  async refreshToken(profileName: string, profile: Profile): Promise<string> {
    try {
      const response = await axios.post(
        `${profile.base_url}/auth/token`,
        {
          clientId: this.env.clientId,
          clientSecret: this.env.clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const { accessToken, expiresIn } = response.data;
      
      // Calculate expiration time (subtract 60 seconds for safety margin)
      const expires_at = Date.now() + (expiresIn - 60) * 1000;
      
      // Cache the token
      this.tokenCache.set(profileName, {
        access_token: accessToken,
        expires_at,
      });
      
      return accessToken;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`Auth failed: ${error.response.data?.error || error.message}`);
      }
      throw new Error(`Auth failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  clearCache(profileName?: string): void {
    if (profileName) {
      this.tokenCache.delete(profileName);
    } else {
      this.tokenCache.clear();
    }
  }
}