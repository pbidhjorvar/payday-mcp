import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

interface Transaction {
  date: Date;
  amount: number;
  description: string;
  reference: string;
  balance: number;
}

interface AccountAnalysis {
  accountNumber: string;
  accountName: string;
  currency: string;
  transactions: Transaction[];
  totalDebits: number;
  totalCredits: number;
  averageTransaction: number;
  largestInflow: number;
  largestOutflow: number;
  endingBalance: number;
  monthlyActivity: Map<string, {debits: number, credits: number, count: number}>;
}

function parseAmount(value: any): number {
  if (!value) return 0;
  const str = String(value).replace(/[^\d,-]/g, '').replace(',', '.');
  return parseFloat(str) || 0;
}

function analyzeAccount(filePath: string): AccountAnalysis | null {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Read as raw array
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  
  // Extract account info
  let accountNumber = '';
  let accountName = '';
  let currency = 'ISK';
  
  if (rawData[1] && rawData[1][0]) {
    const accountLine = rawData[1][0];
    const accountMatch = accountLine.match(/(\d{4}-\d{2}-\d{6})/);
    if (accountMatch) {
      accountNumber = accountMatch[1];
    }
    const typeMatch = accountLine.match(/\d{4}-\d{2}-\d{6}\s+(.+)/);
    if (typeMatch) {
      accountName = typeMatch[1].trim();
    }
  }
  
  // Determine currency
  if (path.basename(filePath).includes('GBP')) currency = 'GBP';
  else if (path.basename(filePath).includes('EUR')) currency = 'EUR';
  
  // Parse transactions (data starts at row 5)
  const transactions: Transaction[] = [];
  let totalDebits = 0;
  let totalCredits = 0;
  let largestInflow = 0;
  let largestOutflow = 0;
  let endingBalance = 0;
  const monthlyActivity = new Map<string, {debits: number, credits: number, count: number}>();
  
  // Column indices (based on header at row 4)
  const headers = rawData[4] || [];
  const dateCol = headers.indexOf('Dags');
  const descCol = headers.indexOf('Texti');
  const amountCol = headers.indexOf('Upphæð');
  const balanceCol = headers.indexOf('Staða');
  const refCol = headers.indexOf('Tilvísun');
  
  for (let i = 5; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !row[dateCol]) continue;
    
    const amount = parseAmount(row[amountCol]);
    const balance = parseAmount(row[balanceCol]);
    
    // Parse date
    let date: Date;
    const dateStr = String(row[dateCol]);
    if (dateStr.includes('.')) {
      // Format: DD.MM.YYYY
      const parts = dateStr.split('.');
      date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    } else {
      date = new Date(row[dateCol]);
    }
    
    if (amount !== 0) {
      transactions.push({
        date,
        amount,
        description: row[descCol] || '',
        reference: row[refCol] || '',
        balance
      });
      
      // Track statistics
      if (amount > 0) {
        totalCredits += amount;
        if (amount > largestInflow) largestInflow = amount;
      } else {
        totalDebits += Math.abs(amount);
        if (Math.abs(amount) > largestOutflow) largestOutflow = Math.abs(amount);
      }
      
      // Monthly aggregation
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthData = monthlyActivity.get(monthKey) || {debits: 0, credits: 0, count: 0};
      if (amount > 0) {
        monthData.credits += amount;
      } else {
        monthData.debits += Math.abs(amount);
      }
      monthData.count++;
      monthlyActivity.set(monthKey, monthData);
    }
    
    // Last balance is ending balance
    if (balance !== 0) {
      endingBalance = balance;
    }
  }
  
  const averageTransaction = transactions.length > 0 
    ? (totalCredits - totalDebits) / transactions.length 
    : 0;
  
  return {
    accountNumber,
    accountName,
    currency,
    transactions,
    totalDebits,
    totalCredits,
    averageTransaction,
    largestInflow,
    largestOutflow,
    endingBalance,
    monthlyActivity
  };
}

// Analyze all accounts
const dataDir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));

console.log('=== DEEP TRANSACTION ANALYSIS ===\n');

const allAnalyses: AccountAnalysis[] = [];
let totalCompanyDebits = 0;
let totalCompanyCredits = 0;

for (const file of files) {
  const analysis = analyzeAccount(path.join(dataDir, file));
  if (analysis) {
    allAnalyses.push(analysis);
    
    console.log(`\n📊 ${analysis.accountName} (${analysis.currency})`);
    console.log(`Account: ${analysis.accountNumber}`);
    console.log(`Transactions: ${analysis.transactions.length}`);
    console.log(`Total Inflows: ${analysis.totalCredits.toLocaleString('is-IS')} ${analysis.currency}`);
    console.log(`Total Outflows: ${analysis.totalDebits.toLocaleString('is-IS')} ${analysis.currency}`);
    console.log(`Net Flow: ${(analysis.totalCredits - analysis.totalDebits).toLocaleString('is-IS')} ${analysis.currency}`);
    console.log(`Current Balance: ${analysis.endingBalance.toLocaleString('is-IS')} ${analysis.currency}`);
    console.log(`Largest Inflow: ${analysis.largestInflow.toLocaleString('is-IS')} ${analysis.currency}`);
    console.log(`Largest Outflow: ${analysis.largestOutflow.toLocaleString('is-IS')} ${analysis.currency}`);
    
    // Convert to ISK for company totals (rough estimates)
    const iskRate = analysis.currency === 'EUR' ? 150 : analysis.currency === 'GBP' ? 175 : 1;
    totalCompanyCredits += analysis.totalCredits * iskRate;
    totalCompanyDebits += analysis.totalDebits * iskRate;
    
    // Find patterns
    const sortedMonths = Array.from(analysis.monthlyActivity.entries()).sort();
    if (sortedMonths.length > 0) {
      console.log('\n📅 Recent Monthly Activity:');
      sortedMonths.slice(-6).forEach(([month, data]) => {
        console.log(`  ${month}: +${data.credits.toLocaleString('is-IS')} / -${data.debits.toLocaleString('is-IS')} (${data.count} trans)`);
      });
    }
    
    // Top descriptions (find recurring payments)
    const descriptionCounts = new Map<string, number>();
    analysis.transactions.forEach(t => {
      if (t.description) {
        const key = t.description.substring(0, 30);
        descriptionCounts.set(key, (descriptionCounts.get(key) || 0) + 1);
      }
    });
    
    const topDescriptions = Array.from(descriptionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topDescriptions.length > 0) {
      console.log('\n🔄 Most Frequent Transactions:');
      topDescriptions.forEach(([desc, count]) => {
        console.log(`  "${desc}..." (${count}x)`);
      });
    }
  }
}

console.log('\n\n=== COMPANY-WIDE INSIGHTS ===\n');
console.log(`💰 Total Company Activity (est. in ISK):`);
console.log(`   Total Inflows: ${totalCompanyCredits.toLocaleString('is-IS')} ISK`);
console.log(`   Total Outflows: ${totalCompanyDebits.toLocaleString('is-IS')} ISK`);
console.log(`   Net Position: ${(totalCompanyCredits - totalCompanyDebits).toLocaleString('is-IS')} ISK`);

// Activity patterns
const allMonthlyTotals = new Map<string, number>();
allAnalyses.forEach(analysis => {
  analysis.monthlyActivity.forEach((data, month) => {
    const current = allMonthlyTotals.get(month) || 0;
    const iskRate = analysis.currency === 'EUR' ? 150 : analysis.currency === 'GBP' ? 175 : 1;
    allMonthlyTotals.set(month, current + (data.credits - data.debits) * iskRate);
  });
});

const sortedCompanyMonths = Array.from(allMonthlyTotals.entries()).sort();
console.log('\n📈 Cash Flow Trends (last 12 months):');
sortedCompanyMonths.slice(-12).forEach(([month, netFlow]) => {
  const bar = netFlow > 0 ? '🟢' : '🔴';
  const bars = Math.min(Math.abs(Math.round(netFlow / 1000000)), 10);
  console.log(`  ${month}: ${bar.repeat(bars || 1)} ${netFlow > 0 ? '+' : ''}${netFlow.toLocaleString('is-IS')} ISK`);
});

// Account usage patterns
console.log('\n🏦 Account Usage Patterns:');
allAnalyses.forEach(analysis => {
  const avgMonthlyTrans = analysis.transactions.length / Math.max(1, analysis.monthlyActivity.size);
  console.log(`  ${analysis.accountName}: ${avgMonthlyTrans.toFixed(1)} trans/month`);
});

console.log('\n💡 Key Observations:');
const mainAccount = allAnalyses.find(a => a.accountNumber === '0133-26-007035');
if (mainAccount) {
  console.log(`  • Main account processes ${mainAccount.transactions.length} transactions (${Math.round(mainAccount.transactions.length / 36)}\/month avg)`);
}

const foreignAccounts = allAnalyses.filter(a => a.currency !== 'ISK');
if (foreignAccounts.length > 0) {
  console.log(`  • Foreign currency accounts: ${foreignAccounts.map(a => a.currency).join(', ')}`);
  foreignAccounts.forEach(acc => {
    if (acc.transactions.length > 0) {
      console.log(`    - ${acc.currency}: ${acc.transactions.length} transactions, balance: ${acc.endingBalance.toLocaleString('is-IS')} ${acc.currency}`);
    }
  });
}

// Check for seasonal patterns
const quarterlyTotals = new Map<string, number>();
allMonthlyTotals.forEach((value, month) => {
  const [year, monthNum] = month.split('-');
  const quarter = `${year}-Q${Math.ceil(parseInt(monthNum) / 3)}`;
  quarterlyTotals.set(quarter, (quarterlyTotals.get(quarter) || 0) + value);
});

console.log('\n📊 Quarterly Performance:');
Array.from(quarterlyTotals.entries()).sort().slice(-8).forEach(([quarter, total]) => {
  console.log(`  ${quarter}: ${total > 0 ? '+' : ''}${total.toLocaleString('is-IS')} ISK`);
});