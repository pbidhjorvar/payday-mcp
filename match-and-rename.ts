import { PaydayClient } from './dist/http/paydayClient.js';
import { AuthClient } from './dist/auth/authClient.js';
import { loadEnv } from './dist/config/env.js';
import { loadProfiles, getProfile } from './dist/config/profiles.js';
import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

interface PaymentType {
  id: string;
  title: string;
  description: string | null;
  created: string;
}

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
    
    // Fetch payment types
    console.log('Fetching Payday payment types...\n');
    const result = await paydayClient.getPaymentTypes();
    
    if ('ok' in result && !result.ok) {
      console.error('Failed to fetch payment types:', result.error);
      return;
    }
    
    const paymentTypes = result as PaymentType[];
    
    console.log('=== PAYDAY PAYMENT TYPES ===\n');
    paymentTypes.forEach((pt: PaymentType) => {
      console.log(`• ${pt.title} (ID: ${pt.id})`);
      if (pt.description) console.log(`  Description: ${pt.description}`);
    });
    
    // Analyze Excel files
    console.log('\n\n=== ANALYZING BANK FILES ===\n');
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
      
      // Determine currency based on account type and file
      if (accountType.toLowerCase().includes('erlend') || 
          accountType.toLowerCase().includes('foreign')) {
        // Based on file naming pattern
        if (file.includes('(2)')) {
          currency = 'GBP';
        } else if (file.includes('(3)')) {
          currency = 'EUR';
        }
      }
      
      // Count actual transaction rows
      const dataStartRow = 5;
      const transactionCount = Math.max(0, rawData.length - dataStartRow);
      
      bankAccounts.push({
        file,
        accountNumber,
        accountType,
        currency,
        transactionCount
      });
    }
    
    console.log('Bank accounts found:\n');
    bankAccounts.forEach(acc => {
      console.log(`File: ${acc.file}`);
      console.log(`  Account: ${acc.accountNumber} - ${acc.accountType}`);
      console.log(`  Currency: ${acc.currency}`);
      console.log(`  Transactions: ${acc.transactionCount}`);
      console.log('');
    });
    
    // Match accounts
    console.log('\n=== MATCHING RESULTS ===\n');
    
    const matches: Array<{file: string, paydayId: string, paydayTitle: string}> = [];
    
    for (const account of bankAccounts) {
      let matchedPaymentType: PaymentType | undefined;
      
      // Match based on account characteristics
      if (account.accountNumber === '0133-26-007035') {
        // Main checking account - Landsbankinn (Debet)
        matchedPaymentType = paymentTypes.find(pt => pt.id === 'c103740e-8289-4d8b-aa93-3aa8742ef209');
      } else if (account.accountNumber === '0133-15-004882') {
        // Interest savings account - Sparnaðarreikningur
        matchedPaymentType = paymentTypes.find(pt => pt.id === '661af492-9b12-4f11-a32c-544a844438b4');
      } else if (account.currency === 'GBP') {
        // GBP account
        matchedPaymentType = paymentTypes.find(pt => pt.id === '3d33b017-3249-43ee-92dd-63a3db8da443');
      } else if (account.currency === 'EUR') {
        // EUR account
        matchedPaymentType = paymentTypes.find(pt => pt.id === 'bae09c55-114e-41fc-8628-f96540a0c1f7');
      }
      
      if (matchedPaymentType) {
        console.log(`✅ MATCHED: ${account.file}`);
        console.log(`   Bank Account: ${account.accountNumber} (${account.currency})`);
        console.log(`   → Payday: ${matchedPaymentType.title} (${matchedPaymentType.id})`);
        console.log('');
        
        matches.push({
          file: account.file,
          paydayId: matchedPaymentType.id,
          paydayTitle: matchedPaymentType.title
        });
      } else {
        console.log(`❌ NO MATCH: ${account.file}`);
        console.log(`   Account: ${account.accountNumber} - ${account.accountType}`);
        console.log('');
      }
    }
    
    // Rename files
    if (matches.length > 0) {
      console.log('\n=== RENAMING FILES ===\n');
      
      for (const match of matches) {
        const oldPath = path.join(dataDir, match.file);
        // Create new filename: PaydayID_Title_OriginalDate.xlsx
        const dateMatch = match.file.match(/\(([^)]+)\)/);
        const date = dateMatch ? dateMatch[1].replace(/_/g, '-') : 'unknown';
        const sanitizedTitle = match.paydayTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const newFileName = `${match.paydayId}_${sanitizedTitle}_${date}.xlsx`;
        const newPath = path.join(dataDir, newFileName);
        
        try {
          fs.renameSync(oldPath, newPath);
          console.log(`✅ Renamed: ${match.file}`);
          console.log(`   → ${newFileName}`);
        } catch (error) {
          console.log(`❌ Failed to rename: ${match.file}`);
          console.log(`   Error: ${error}`);
        }
      }
    }
    
    console.log('\n=== SUMMARY ===\n');
    console.log(`Total files: ${bankAccounts.length}`);
    console.log(`Successfully matched and renamed: ${matches.length}`);
    console.log('\nFile naming convention: {PaydayID}_{PaydayTitle}_{Date}.xlsx');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();