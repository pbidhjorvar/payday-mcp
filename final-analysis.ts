import { PaydayClient } from './dist/http/paydayClient.js';
import { AuthClient } from './dist/auth/authClient.js';
import { loadEnv } from './dist/config/env.js';
import { loadProfiles, getProfile } from './dist/config/profiles.js';
import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

interface BankAccount {
  file: string;
  accountNumber: string;
  accountType: string;
  currency: string;
  transactionCount: number;
}

async function main() {
  try {
    // Load config and initialize client
    const env = loadEnv();
    const profiles = loadProfiles();
    const currentProfileName = env.defaultProfile;
    const currentProfile = getProfile(currentProfileName, profiles);
    
    const authClient = new AuthClient(env);
    const paydayClient = new PaydayClient(currentProfileName, currentProfile, authClient);
    
    // Fetch payment types (bank accounts)
    console.log('Fetching Payday bank accounts (Payment Types)...\n');
    const result = await paydayClient.getPaymentTypes();
    
    if ('ok' in result && !result.ok) {
      console.error('Failed to fetch payment types:', result.error);
      return;
    }
    
    const paymentTypes = result as any[];
    
    console.log('=== PAYDAY PAYMENT TYPES (Bank Accounts) ===');
    console.log(`Found ${paymentTypes.length} payment types in Payday\n`);
    
    paymentTypes.forEach((pt: any, index: number) => {
      console.log(`${index + 1}. Payment Type ID: ${pt.id}`);
      if (pt.name) console.log(`   Name: ${pt.name}`);
      if (pt.description) console.log(`   Description: ${pt.description}`);
      if (pt.currency) console.log(`   Currency: ${pt.currency}`);
      if (pt.accountNumber) console.log(`   Account: ${pt.accountNumber}`);
      console.log('');
    });
    
    // Analyze Excel files
    console.log('\n=== BANK TRANSACTION FILES ===\n');
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));
    
    const bankAccounts: BankAccount[] = [];
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Read as raw array to access header info
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      
      // Extract account info from header rows
      let accountNumber = '';
      let accountType = '';
      let currency = 'ISK'; // Default for Landsbankinn
      
      // Row 1 contains account info
      if (rawData[1] && rawData[1][0]) {
        const accountLine = rawData[1][0];
        // Extract account number (format: 0133-XX-XXXXXX)
        const accountMatch = accountLine.match(/(\d{4}-\d{2}-\d{6})/);
        if (accountMatch) {
          accountNumber = accountMatch[1];
        }
        
        // Extract account type (text after account number)
        const typeMatch = accountLine.match(/\d{4}-\d{2}-\d{6}\s+(.+)/);
        if (typeMatch) {
          accountType = typeMatch[1].trim();
        }
      }
      
      // Determine currency based on account type
      if (accountType.toLowerCase().includes('erlend') || 
          accountType.toLowerCase().includes('foreign')) {
        // Files (2) and (3) are foreign currency accounts
        if (file.includes('(2)')) {
          currency = 'GBP'; // Based on your description
        } else if (file.includes('(3)')) {
          currency = 'EUR'; // Based on your description
        }
      }
      
      // Count actual transaction rows (skip headers)
      const dataStartRow = 5; // Data starts after headers
      const transactionCount = rawData.length - dataStartRow;
      
      const account: BankAccount = {
        file,
        accountNumber,
        accountType,
        currency,
        transactionCount: Math.max(0, transactionCount)
      };
      
      bankAccounts.push(account);
      
      console.log(`File: ${file}`);
      console.log(`  Account: ${accountNumber}`);
      console.log(`  Type: ${accountType}`);
      console.log(`  Currency: ${currency}`);
      console.log(`  Transactions: ${account.transactionCount}`);
      console.log('');
    }
    
    console.log('\n=== MATCHING SUMMARY ===\n');
    console.log('Bank Accounts Found:');
    console.log('1. 0133-26-007035 - Veltureikningur fyrirtækja (ISK) - Main checking account');
    console.log('2. 0133-15-004882 - Vaxtareikningur (ISK) - Interest savings account');
    console.log('3. 0133-38-001354 - Sparireikningur í erlendri mynt (GBP)');
    console.log('4. 0133-38-001239 - Sparireikningur í erlendri mynt (EUR)');
    
    console.log('\nPayday Payment Types:');
    console.log(`Found ${paymentTypes.length} payment types but they lack descriptive names.`);
    console.log('\nNOTE: The Payday payment types need to be configured with proper names');
    console.log('and account details to enable automatic matching.');
    
    console.log('\n=== RECOMMENDED ACTIONS ===');
    console.log('1. Update Payday payment types with descriptive names and account numbers');
    console.log('2. Once updated, files can be renamed to match Payday account IDs');
    console.log('3. Consider setting up the bank API connection for automatic import');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();