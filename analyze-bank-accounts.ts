import { PaydayClient } from './dist/http/paydayClient.js';
import { AuthClient } from './dist/auth/authClient.js';
import { loadEnv } from './dist/config/env.js';
import { loadProfiles, getProfile } from './dist/config/profiles.js';
import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

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
    
    console.log('=== PAYDAY BANK ACCOUNTS ===');
    paymentTypes.forEach((pt: any, index: number) => {
      console.log(`\n${index + 1}. ${pt.name || 'Unnamed'}`);
      console.log(`   ID: ${pt.id}`);
      console.log(`   Type: ${pt.type || 'N/A'}`);
      console.log(`   Currency: ${pt.currency || 'N/A'}`);
      if (pt.description) console.log(`   Description: ${pt.description}`);
      if (pt.accountNumber) console.log(`   Account Number: ${pt.accountNumber}`);
      if (pt.bank) console.log(`   Bank: ${pt.bank}`);
    });
    
    // Read Excel files
    console.log('\n\n=== EXCEL FILES ANALYSIS ===');
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));
    
    const fileInfo: any[] = [];
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);
      
      if (data.length > 0) {
        const firstRow = data[0] as any;
        
        // Determine which columns contain account info and amounts
        const columns = Object.keys(firstRow);
        
        // Try to identify account and currency from the data
        let accountInfo = 'Unknown';
        let currency = 'Unknown';
        let totalDebit = 0;
        let totalCredit = 0;
        
        // Look for account in columns
        const accountColumns = ['Reikningur', 'Account', 'Reikningsnúmer', 'AccountNumber', 'Account Number'];
        for (const col of accountColumns) {
          if (firstRow[col]) {
            accountInfo = firstRow[col];
            break;
          }
        }
        
        // Check all rows for consistent account number
        const accountNumbers = new Set();
        data.forEach((row: any) => {
          for (const col of accountColumns) {
            if (row[col]) {
              accountNumbers.add(row[col]);
            }
          }
        });
        
        if (accountNumbers.size === 1) {
          accountInfo = Array.from(accountNumbers)[0] as string;
        } else if (accountNumbers.size > 1) {
          console.log(`  Multiple account numbers found in ${file}:`, Array.from(accountNumbers));
        }
        
        // Try to detect currency and sum amounts
        data.forEach((row: any) => {
          // Look for debit/credit columns
          const debitCols = columns.filter(c => 
            c.toLowerCase().includes('debit') || 
            c.toLowerCase().includes('úttekt') ||
            c.toLowerCase().includes('skuldfærsla')
          );
          const creditCols = columns.filter(c => 
            c.toLowerCase().includes('credit') || 
            c.toLowerCase().includes('innlegg') ||
            c.toLowerCase().includes('innborgun')
          );
          
          debitCols.forEach(col => {
            const val = parseFloat(String(row[col] || '0').replace(/[^0-9.-]/g, ''));
            if (!isNaN(val)) totalDebit += val;
          });
          
          creditCols.forEach(col => {
            const val = parseFloat(String(row[col] || '0').replace(/[^0-9.-]/g, ''));
            if (!isNaN(val)) totalCredit += val;
          });
          
          // Try to detect currency from any text field
          const rowText = JSON.stringify(row);
          if (rowText.includes('GBP') || rowText.includes('£')) currency = 'GBP';
          else if (rowText.includes('EUR') || rowText.includes('€')) currency = 'EUR';
          else if (rowText.includes('ISK') || rowText.includes('kr.')) currency = 'ISK';
        });
        
        // If currency still unknown, default to ISK for Landsbankinn
        if (currency === 'Unknown' && file.includes('Landsbankinn')) {
          currency = 'ISK';
        }
        
        console.log(`\n${file}:`);
        console.log(`  Transactions: ${data.length}`);
        console.log(`  Account: ${accountInfo}`);
        console.log(`  Currency: ${currency}`);
        console.log(`  Total Debits: ${totalDebit.toFixed(2)}`);
        console.log(`  Total Credits: ${totalCredit.toFixed(2)}`);
        console.log(`  Net: ${(totalCredit - totalDebit).toFixed(2)}`);
        
        fileInfo.push({
          file,
          rows: data.length,
          account: accountInfo,
          currency,
          totalDebit,
          totalCredit,
          net: totalCredit - totalDebit
        });
      }
    }
    
    console.log('\n\n=== MATCHING SUGGESTIONS ===');
    console.log('Based on the analysis, potential matches:\n');
    
    fileInfo.forEach(info => {
      console.log(`File: ${info.file}`);
      console.log(`  Account from file: ${info.account}`);
      console.log(`  Currency: ${info.currency}`);
      
      // Try to find matching Payday account by currency
      const matchingPayday = paymentTypes.filter((pt: any) => 
        pt.currency === info.currency || 
        (info.currency === 'ISK' && !pt.currency) // ISK might be default
      );
      
      if (matchingPayday.length > 0) {
        console.log(`  Potential Payday matches:`);
        matchingPayday.forEach((pt: any) => {
          console.log(`    - ${pt.name} (ID: ${pt.id}, Currency: ${pt.currency || 'ISK'})`);
        });
      } else {
        console.log(`  No Payday account found with currency ${info.currency}`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();