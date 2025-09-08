import dotenv from 'dotenv';

dotenv.config();

export interface EnvConfig {
  clientId: string;
  clientSecret: string;
  defaultProfile: string;
}

export function loadEnv(): EnvConfig {
  const clientId = process.env.PAYDAY_CLIENT_ID;
  const clientSecret = process.env.PAYDAY_CLIENT_SECRET;
  const defaultProfile = process.env.PAYDAY_DEFAULT_PROFILE || 'test';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing required environment variables: PAYDAY_CLIENT_ID and PAYDAY_CLIENT_SECRET'
    );
  }

  return {
    clientId,
    clientSecret,
    defaultProfile,
  };
}