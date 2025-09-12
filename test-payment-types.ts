import { PaydayClient } from './src/http/paydayClient.js';
import { loadConfig } from './src/lib/config.js';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  try {
    // Load config and initialize client
    const config = loadConfig();
    const client = new PaydayClient(config);
    
    // Fetch payment types (bank accounts)
    console.log('Fetching Payday bank accounts (Payment Types)...\n');
    const paymentTypes = await client.getPaymentTypes();
    
    console.log('=== PAYDAY BANK ACCOUNTS ===');
    paymentTypes.forEach((pt: any, index: number) => {
      console.log(`\n${index + 1}. ${pt.name || 'Unnamed'}`);
      console.log(`   ID: ${pt.id}`);
      console.log(`   Type: ${pt.type || 'N/A'}`);
      console.log(`   Currency: ${pt.currency || 'N/A'}`);
      if (pt.description) console.log(`   Description: ${pt.description}`);
      if (pt.accountNumber) console.log(`   Account Number: ${pt.accountNumber}`);
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
        const lastRow = data[data.length - 1] as any;
        
        // Try to identify account info from the data
        let accountInfo = 'Unknown';
        let currency = 'Unknown';
        
        // Check for account number in various possible column names
        const accountColumns = ['Reikningur', 'Account', 'Reikningsnúmer', 'AccountNumber'];
        for (const col of accountColumns) {
          if (firstRow[col]) {
            accountInfo = firstRow[col];
            break;
          }
        }
        
        // Try to detect currency from amount columns or data
        const amountColumns = Object.keys(firstRow).filter(k => 
          k.toLowerCase().includes('amount') || 
          k.toLowerCase().includes('upphæð') ||
          k.toLowerCase().includes('fjárhæð')
        );
        
        // Check if amounts contain currency symbols
        if (amountColumns.length > 0) {
          const sampleAmount = String(firstRow[amountColumns[0]] || '');
          if (sampleAmount.includes('£') || sampleAmount.includes('GBP')) currency = 'GBP';
          else if (sampleAmount.includes('€') || sampleAmount.includes('EUR')) currency = 'EUR';
          else if (sampleAmount.includes('kr') || sampleAmount.includes('ISK')) currency = 'ISK';
        }
        
        console.log(`\n${file}:`);
        console.log(`  Rows: ${data.length}`);
        console.log(`  Columns: ${Object.keys(firstRow).join(', ')}`);
        if (accountInfo !== 'Unknown') console.log(`  Account: ${accountInfo}`);
        console.log(`  Detected Currency: ${currency}`);
        
        fileInfo.push({
          file,
          rows: data.length,
          account: accountInfo,
          currency,
          columns: Object.keys(firstRow)
        });
      }
    }
    
    console.log('\n\n=== MATCHING SUGGESTIONS ===');
    console.log('Based on the analysis, here are potential matches:');
    console.log('(Manual verification needed)\n');
    
    fileInfo.forEach(info => {
      console.log(`File: ${info.file}`);
      console.log(`  - Currency: ${info.currency}`);
      console.log(`  - Account info from file: ${info.account}`);
      console.log(`  - Suggested Payday match: [To be determined based on currency and account details]`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();