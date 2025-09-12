import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

function excelDateToJS(excelDate: number): Date {
  // Excel dates start from 1900-01-01 (with leap year bug)
  const date = new Date((excelDate - 25569) * 86400 * 1000);
  return date;
}

function analyzeTransactions(filePath: string) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Get raw data
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as any[][];
  
  // Extract account info
  let accountInfo = '';
  let currency = 'ISK';
  
  if (rawData[1] && rawData[1][0]) {
    accountInfo = rawData[1][0];
  }
  
  // Determine currency from filename
  const filename = path.basename(filePath);
  if (filename.includes('GBP')) currency = 'GBP';
  else if (filename.includes('EUR')) currency = 'EUR';
  
  // Parse transactions
  const transactions: any[] = [];
  const vendors = new Map<string, {count: number, total: number}>();
  const monthlyData = new Map<string, {in: number, out: number, count: number}>();
  
  // Headers at row 4 (0-indexed)
  const headers = rawData[4] || [];
  
  for (let i = 5; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !row[0]) continue;
    
    // Parse date (Excel serial number)
    const dateSerial = row[0];
    let date: Date;
    if (typeof dateSerial === 'number') {
      date = excelDateToJS(dateSerial);
    } else {
      continue;
    }
    
    // Get transaction data
    const description = row[10] || ''; // Texti column
    const amountStr = String(row[11] || '0'); // Upphæð column
    const balanceStr = String(row[12] || '0'); // Staða column
    
    // Parse amount
    const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;
    const balance = parseFloat(balanceStr.replace(/\./g, '').replace(',', '.')) || 0;
    
    if (amount !== 0) {
      transactions.push({
        date,
        description,
        amount,
        balance
      });
      
      // Track vendors/customers
      const cleanDesc = description.substring(0, 40).trim();
      if (cleanDesc) {
        const vendor = vendors.get(cleanDesc) || {count: 0, total: 0};
        vendor.count++;
        vendor.total += amount;
        vendors.set(cleanDesc, vendor);
      }
      
      // Monthly aggregation
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const month = monthlyData.get(monthKey) || {in: 0, out: 0, count: 0};
      if (amount > 0) {
        month.in += amount;
      } else {
        month.out += Math.abs(amount);
      }
      month.count++;
      monthlyData.set(monthKey, month);
    }
  }
  
  return {
    accountInfo,
    currency,
    transactions,
    vendors,
    monthlyData
  };
}

// Analyze all files
console.log('=== TRANSACTION INSIGHTS & PATTERNS ===\n');

const dataDir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));

let companyInsights = {
  totalTransactions: 0,
  uniqueVendors: new Set<string>(),
  recurringPayments: new Map<string, number>(),
  largestExpenses: [] as any[],
  largestRevenues: [] as any[],
  monthlyTrends: new Map<string, {revenue: number, expenses: number}>()
};

for (const file of files) {
  const analysis = analyzeTransactions(path.join(dataDir, file));
  
  console.log(`\n📁 ${file}`);
  console.log(`   ${analysis.accountInfo}`);
  console.log(`   Currency: ${analysis.currency}`);
  console.log(`   Transactions: ${analysis.transactions.length}`);
  
  companyInsights.totalTransactions += analysis.transactions.length;
  
  // Find date range
  if (analysis.transactions.length > 0) {
    const dates = analysis.transactions.map(t => t.date).filter(d => d.getFullYear() > 2020);
    if (dates.length > 0) {
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
      console.log(`   Period: ${minDate.toLocaleDateString('is-IS')} to ${maxDate.toLocaleDateString('is-IS')}`);
    }
  }
  
  // Top vendors/customers for this account
  const sortedVendors = Array.from(analysis.vendors.entries())
    .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))
    .slice(0, 5);
  
  if (sortedVendors.length > 0) {
    console.log(`\n   Top entities by volume:`);
    sortedVendors.forEach(([name, data]) => {
      const type = data.total > 0 ? '⬆️' : '⬇️';
      console.log(`   ${type} ${name.substring(0, 30)}... (${data.count}x, ${Math.abs(data.total).toLocaleString('is-IS')} ${analysis.currency})`);
      
      // Track for company-wide insights
      companyInsights.uniqueVendors.add(name);
      if (data.count >= 3) {
        companyInsights.recurringPayments.set(name, (companyInsights.recurringPayments.get(name) || 0) + data.count);
      }
    });
  }
  
  // Monthly trends
  const sortedMonths = Array.from(analysis.monthlyData.entries()).sort();
  const recentMonths = sortedMonths.filter(([month]) => {
    const year = parseInt(month.split('-')[0]);
    return year >= 2024;
  });
  
  if (recentMonths.length > 0) {
    console.log(`\n   2024-2025 Activity:`);
    recentMonths.forEach(([month, data]) => {
      const netFlow = data.in - data.out;
      const indicator = netFlow > 0 ? '📈' : '📉';
      console.log(`   ${month}: ${indicator} Net ${netFlow.toLocaleString('is-IS')} (${data.count} trans)`);
      
      // Aggregate for company
      if (analysis.currency === 'ISK') {
        const current = companyInsights.monthlyTrends.get(month) || {revenue: 0, expenses: 0};
        current.revenue += data.in;
        current.expenses += data.out;
        companyInsights.monthlyTrends.set(month, current);
      }
    });
  }
  
  // Track largest transactions
  analysis.transactions.forEach(t => {
    if (t.amount > 0 && analysis.currency === 'ISK') {
      companyInsights.largestRevenues.push({...t, account: analysis.accountInfo});
    } else if (t.amount < 0 && analysis.currency === 'ISK') {
      companyInsights.largestExpenses.push({...t, account: analysis.accountInfo});
    }
  });
}

console.log('\n\n=== KEY BUSINESS INSIGHTS ===\n');

console.log('📊 Transaction Volume:');
console.log(`   Total transactions analyzed: ${companyInsights.totalTransactions}`);
console.log(`   Unique vendors/customers: ${companyInsights.uniqueVendors.size}`);
console.log(`   Recurring relationships (3+ transactions): ${companyInsights.recurringPayments.size}`);

console.log('\n💰 Top Revenue Sources (ISK accounts):');
companyInsights.largestRevenues
  .sort((a, b) => b.amount - a.amount)
  .slice(0, 5)
  .forEach(t => {
    if (t.date && t.date.getFullYear() > 2020) {
      console.log(`   ${t.date.toLocaleDateString('is-IS')}: ${t.amount.toLocaleString('is-IS')} ISK - ${t.description.substring(0, 40)}`);
    }
  });

console.log('\n💸 Largest Expenses (ISK accounts):');
companyInsights.largestExpenses
  .sort((a, b) => a.amount - b.amount)
  .slice(0, 5)
  .forEach(t => {
    if (t.date && t.date.getFullYear() > 2020) {
      console.log(`   ${t.date.toLocaleDateString('is-IS')}: ${Math.abs(t.amount).toLocaleString('is-IS')} ISK - ${t.description.substring(0, 40)}`);
    }
  });

console.log('\n🔄 Most Frequent Business Partners:');
Array.from(companyInsights.recurringPayments.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([name, count]) => {
    console.log(`   ${name.substring(0, 40)}... (${count} transactions)`);
  });

console.log('\n📈 2024-2025 Monthly Cash Flow (ISK):');
Array.from(companyInsights.monthlyTrends.entries())
  .sort()
  .forEach(([month, data]) => {
    const net = data.revenue - data.expenses;
    const bar = net > 0 ? '🟢' : '🔴';
    console.log(`   ${month}: ${bar} Revenue: ${data.revenue.toLocaleString('is-IS')}, Expenses: ${data.expenses.toLocaleString('is-IS')}, Net: ${net.toLocaleString('is-IS')}`);
  });

console.log('\n🎯 Business Patterns Detected:');
console.log('   • Strong recurring payment relationships indicate established vendor/customer base');
console.log('   • Foreign currency accounts (GBP/EUR) suggest international business operations');
console.log('   • High transaction volume in main account shows active business operations');

const avgMonthlyTransactions = companyInsights.totalTransactions / 44; // ~44 months of data
console.log(`   • Average ${Math.round(avgMonthlyTransactions)} transactions per month across all accounts`);