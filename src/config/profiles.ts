import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Profile {
  base_url: string;
  company_id: string | null;
  read_only: boolean;
}

export type ProfilesConfig = Record<string, Profile>;

export function loadProfiles(): ProfilesConfig {
  const profilesPath = path.join(__dirname, '..', '..', 'profiles.json');
  
  if (!fs.existsSync(profilesPath)) {
    // Return default profile if profiles.json doesn't exist
    return {
      test: {
        base_url: 'https://api.test.payday.is',
        company_id: null,
        read_only: true,
      },
    };
  }

  try {
    const content = fs.readFileSync(profilesPath, 'utf-8');
    return JSON.parse(content) as ProfilesConfig;
  } catch (error) {
    throw new Error(`Failed to parse profiles.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function getProfile(profileName: string, profiles: ProfilesConfig): Profile {
  const profile = profiles[profileName];
  
  if (!profile) {
    throw new Error(`Profile "${profileName}" not found in profiles.json`);
  }
  
  return profile;
}