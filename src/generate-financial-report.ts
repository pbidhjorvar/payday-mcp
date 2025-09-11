#!/usr/bin/env node

import { loadEnv } from './config/env.js';
import { loadProfiles, getProfile } from './config/profiles.js';
import { AuthClient } from './auth/authClient.js';
import { PaydayClient } from './http/paydayClient.js';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string;
  balance?: number;
  currency?: string;
}

interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  accountCode: string;
  accountName: string;
  debit?: number;
  credit?: number;
}


class FinancialReportGenerator {
  private client: PaydayClient;

  constructor(client: PaydayClient) {
    this.client = client;
  }

  async fetchAccounts(): Promise<Account[]> {
    console.log('Fetching chart of accounts...');
    const result = await this.client.get('/accounting/accounts', { perpage: 500 });
    
    if ('error' in result) {
      console.error('Error fetching accounts:', result.error);
      return [];
    }

    const accounts = Array.isArray(result) ? result : (result as any).data || [];
    console.log(`Found ${accounts.length} accounts`);
    return accounts;
  }

  async fetchAccountStatements(year: number): Promise<Transaction[]> {
    const dateFrom = `${year}-01-01`;
    const dateTo = `${year}-12-31`;
    
    console.log(`Fetching account statements for ${year}...`);
    const result = await this.client.get('/accounting/accountStatement', {
      dateFrom,
      dateTo,
      page: 1,
      perpage: 100
    });

    if ('error' in result) {
      console.error(`Error fetching statements for ${year}:`, result.error);
      return [];
    }

    // Account statement returns object with 'lines' property
    const response = result as any;
    let allTransactions = response.lines || [];
    
    // Auto-paginate to get all data
    if (response.pages && response.pages > 1) {
      for (let page = 2; page <= Math.min(response.pages, 50); page++) {
        const pageResult = await this.client.get('/accounting/accountStatement', {
          dateFrom,
          dateTo,
          page,
          perpage: 100
        });
        
        if (!('error' in pageResult)) {
          const pageResponse = pageResult as any;
          if (pageResponse.lines) {
            allTransactions = allTransactions.concat(pageResponse.lines);
          }
        }
      }
    }

    console.log(`Found ${allTransactions.length} transactions for ${year}`);
    return allTransactions;
  }

  groupAccountsByType(accounts: Account[]): { [key: string]: Account[] } {
    const grouped: { [key: string]: Account[] } = {};
    
    for (const account of accounts) {
      const key = `${account.type}_${account.subType || 'Other'}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(account);
    }
    
    return grouped;
  }

  calculateAccountBalances(accounts: Account[], transactions: Transaction[]): Account[] {
    const balances: { [code: string]: number } = {};
    
    // Initialize balances
    accounts.forEach(account => {
      balances[account.code] = 0;
    });
    
    // Calculate balances from transactions
    transactions.forEach(transaction => {
      if (balances[transaction.accountCode] !== undefined) {
        balances[transaction.accountCode] += transaction.amount || 0;
      }
    });
    
    // Update accounts with calculated balances
    return accounts.map(account => ({
      ...account,
      balance: balances[account.code] || 0
    }));
  }

  generateIncomeStatement(accounts: Account[], transactions: Transaction[], year: number): string {
    const incomeAccounts = accounts.filter(a => a.type === 'Income' || a.type === 'Revenue');
    const expenseAccounts = accounts.filter(a => a.type === 'Expense' || a.type === 'Cost');
    
    let report = `\n## INCOME STATEMENT (PROFIT & LOSS) - ${year}\n`;
    report += `### Tekjur (Revenue)\n`;
    
    let totalRevenue = 0;
    const revenueByAccount: { [key: string]: number } = {};
    
    incomeAccounts.forEach(account => {
      const accountTransactions = transactions.filter(t => t.accountCode === account.code);
      const total = accountTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      revenueByAccount[account.code] = Math.abs(total); // Income accounts typically have negative balances
      totalRevenue += Math.abs(total);
    });
    
    // Sort revenue accounts by amount (descending)
    Object.entries(revenueByAccount)
      .sort(([,a], [,b]) => b - a)
      .forEach(([code, amount]) => {
        const account = accounts.find(a => a.code === code);
        if (account && amount > 0) {
          report += `${account.code} - ${account.name}: ${this.formatCurrency(amount)}\n`;
        }
      });
    
    report += `**Heildartekjur (Total Revenue): ${this.formatCurrency(totalRevenue)}**\n\n`;
    
    report += `### Kostnaður (Expenses)\n`;
    
    let totalExpenses = 0;
    const expenseByAccount: { [key: string]: number } = {};
    
    expenseAccounts.forEach(account => {
      const accountTransactions = transactions.filter(t => t.accountCode === account.code);
      const total = accountTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      expenseByAccount[account.code] = Math.abs(total);
      totalExpenses += Math.abs(total);
    });
    
    // Sort expense accounts by amount (descending)
    Object.entries(expenseByAccount)
      .sort(([,a], [,b]) => b - a)
      .forEach(([code, amount]) => {
        const account = accounts.find(a => a.code === code);
        if (account && amount > 0) {
          report += `${account.code} - ${account.name}: ${this.formatCurrency(amount)}\n`;
        }
      });
    
    report += `**Heildarkostnaður (Total Expenses): ${this.formatCurrency(totalExpenses)}**\n\n`;
    
    const netIncome = totalRevenue - totalExpenses;
    report += `### Nettótekjur (Net Income)\n`;
    report += `**${this.formatCurrency(netIncome)}** ${netIncome >= 0 ? '(Hagnaður)' : '(Tap)'}\n`;
    
    return report;
  }

  generateBalanceSheet(accounts: Account[], year: number): string {
    const assetAccounts = accounts.filter(a => a.type === 'Asset');
    const liabilityAccounts = accounts.filter(a => a.type === 'Liability');
    const equityAccounts = accounts.filter(a => a.type === 'Equity');
    
    let report = `\n## BALANCE SHEET - ${year}-12-31\n`;
    
    report += `### Eignir (Assets)\n`;
    let totalAssets = 0;
    
    const assetGroups = this.groupBySubType(assetAccounts);
    Object.entries(assetGroups).forEach(([subType, groupAccounts]) => {
      if (groupAccounts.length > 0) {
        report += `\n#### ${subType}\n`;
        groupAccounts.forEach(account => {
          if (account.balance && Math.abs(account.balance) > 0) {
            report += `${account.code} - ${account.name}: ${this.formatCurrency(Math.abs(account.balance || 0))}\n`;
            totalAssets += Math.abs(account.balance);
          }
        });
      }
    });
    
    report += `\n**Heildareignir (Total Assets): ${this.formatCurrency(totalAssets)}**\n`;
    
    report += `\n### Skuldir og Eigið Fé (Liabilities & Equity)\n`;
    
    report += `\n#### Skuldir (Liabilities)\n`;
    let totalLiabilities = 0;
    
    const liabilityGroups = this.groupBySubType(liabilityAccounts);
    Object.entries(liabilityGroups).forEach(([, groupAccounts]) => {
      if (groupAccounts.length > 0) {
        groupAccounts.forEach(account => {
          if (account.balance && Math.abs(account.balance) > 0) {
            report += `${account.code} - ${account.name}: ${this.formatCurrency(Math.abs(account.balance || 0))}\n`;
            totalLiabilities += Math.abs(account.balance);
          }
        });
      }
    });
    
    report += `\n#### Eigið Fé (Equity)\n`;
    let totalEquity = 0;
    
    equityAccounts.forEach(account => {
      if (account.balance && Math.abs(account.balance) > 0) {
        report += `${account.code} - ${account.name}: ${this.formatCurrency(Math.abs(account.balance || 0))}\n`;
        totalEquity += Math.abs(account.balance);
      }
    });
    
    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
    
    report += `\n**Heildarskuldir (Total Liabilities): ${this.formatCurrency(totalLiabilities)}**\n`;
    report += `**Heildareignfé (Total Equity): ${this.formatCurrency(totalEquity)}**\n`;
    report += `**Heildarskuldir og Eigið Fé: ${this.formatCurrency(totalLiabilitiesAndEquity)}**\n`;
    
    return report;
  }

  private groupBySubType(accounts: Account[]): { [key: string]: Account[] } {
    const grouped: { [key: string]: Account[] } = {};
    
    accounts.forEach(account => {
      const key = account.subType || 'Other';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(account);
    });
    
    return grouped;
  }

  generateYearOverYearComparison(
    accounts2023: Account[],
    accounts2024: Account[],
    transactions2023: Transaction[],
    transactions2024: Transaction[]
  ): string {
    let report = `\n## YEAR-OVER-YEAR COMPARISON (2023 vs 2024)\n`;
    
    // Calculate key metrics for both years
    const metrics2023 = this.calculateKeyMetrics(accounts2023, transactions2023);
    const metrics2024 = this.calculateKeyMetrics(accounts2024, transactions2024);
    
    report += `### Key Financial Metrics\n`;
    report += `| Metric | 2023 | 2024 | Change | % Change |\n`;
    report += `|--------|------|------|---------|----------|\n`;
    
    Object.keys(metrics2023).forEach(metric => {
      const val2023 = metrics2023[metric];
      const val2024 = metrics2024[metric];
      const change = val2024 - val2023;
      const percentChange = val2023 !== 0 ? (change / val2023) * 100 : 0;
      
      report += `| ${metric} | ${this.formatCurrency(val2023)} | ${this.formatCurrency(val2024)} | ${this.formatCurrency(change)} | ${percentChange.toFixed(1)}% |\n`;
    });
    
    return report;
  }

  private calculateKeyMetrics(accounts: Account[], transactions: Transaction[]): { [key: string]: number } {
    const incomeAccounts = accounts.filter(a => a.type === 'Income' || a.type === 'Revenue');
    const expenseAccounts = accounts.filter(a => a.type === 'Expense' || a.type === 'Cost');
    const assetAccounts = accounts.filter(a => a.type === 'Asset');
    const liabilityAccounts = accounts.filter(a => a.type === 'Liability');
    
    let totalRevenue = 0;
    incomeAccounts.forEach(account => {
      const accountTransactions = transactions.filter(t => t.accountCode === account.code);
      const total = accountTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      totalRevenue += Math.abs(total);
    });
    
    let totalExpenses = 0;
    expenseAccounts.forEach(account => {
      const accountTransactions = transactions.filter(t => t.accountCode === account.code);
      const total = accountTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      totalExpenses += Math.abs(total);
    });
    
    const netIncome = totalRevenue - totalExpenses;
    const totalAssets = assetAccounts.reduce((sum, acc) => sum + Math.abs(acc.balance || 0), 0);
    const totalLiabilities = liabilityAccounts.reduce((sum, acc) => sum + Math.abs(acc.balance || 0), 0);
    
    return {
      'Total Revenue': totalRevenue,
      'Total Expenses': totalExpenses,
      'Net Income': netIncome,
      'Total Assets': totalAssets,
      'Total Liabilities': totalLiabilities,
    };
  }

  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('is-IS', {
      style: 'currency',
      currency: 'ISK',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  async generateComprehensiveReport(): Promise<string> {
    console.log('Starting financial report generation...');
    
    try {
      // Fetch all necessary data
      const accounts = await this.fetchAccounts();
      const transactions2023 = await this.fetchAccountStatements(2023);
      const transactions2024 = await this.fetchAccountStatements(2024);
      
      if (accounts.length === 0) {
        return 'Error: Could not fetch chart of accounts. Please check API credentials and connection.';
      }
      
      // Calculate balances for each year
      const accounts2023 = this.calculateAccountBalances(accounts, transactions2023);
      const accounts2024 = this.calculateAccountBalances(accounts, transactions2024);
      
      // Generate report sections
      let report = `# COMPREHENSIVE FINANCIAL REPORT\n`;
      report += `Generated on: ${new Date().toISOString().split('T')[0]}\n`;
      report += `Currency: ISK (Icelandic Króna)\n`;
      report += `Accounting Standards: Icelandic GAAP\n`;
      
      // Income Statements
      report += this.generateIncomeStatement(accounts2023, transactions2023, 2023);
      report += this.generateIncomeStatement(accounts2024, transactions2024, 2024);
      
      // Balance Sheets
      report += this.generateBalanceSheet(accounts2023, 2023);
      report += this.generateBalanceSheet(accounts2024, 2024);
      
      // Year-over-year comparison
      report += this.generateYearOverYearComparison(accounts2023, accounts2024, transactions2023, transactions2024);
      
      // Account analysis summary
      report += `\n## ACCOUNT ANALYSIS SUMMARY\n`;
      report += `Total accounts in chart: ${accounts.length}\n`;
      report += `Transactions in 2023: ${transactions2023.length}\n`;
      report += `Transactions in 2024: ${transactions2024.length}\n`;
      
      const accountTypes = [...new Set(accounts.map(a => a.type))];
      report += `\nAccount types: ${accountTypes.join(', ')}\n`;
      
      return report;
      
    } catch (error) {
      console.error('Error generating report:', error);
      return `Error generating financial report: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}

async function main() {
  try {
    // Initialize configuration
    const env = loadEnv();
    const profiles = loadProfiles();
    const currentProfileName = env.defaultProfile;
    const currentProfile = getProfile(currentProfileName, profiles);

    // Initialize clients
    const authClient = new AuthClient(env);
    const paydayClient = new PaydayClient(currentProfileName, currentProfile, authClient);

    // Generate report
    const generator = new FinancialReportGenerator(paydayClient);
    const report = await generator.generateComprehensiveReport();
    
    // Save to file
    const fs = await import('fs');
    const filename = `financial-report-${new Date().toISOString().split('T')[0]}.md`;
    fs.writeFileSync(filename, report);
    
    console.log(`\nFinancial report generated successfully!`);
    console.log(`Report saved to: ${filename}`);
    console.log(`\nReport preview:\n${report.substring(0, 1000)}...`);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}