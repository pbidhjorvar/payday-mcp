import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getAccountsSchema, getAccountStatementSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const getAccountsTool = {
  name: 'payday_get_accounts',
  description: 'Get chart of accounts',
  inputSchema: getAccountsSchema,
  handler: async (
    input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const { page, perpage } = validatePagination({
      page: input.page,
      perpage: input.perpage ?? 50,
    });

    const params: Record<string, any> = { page, perpage };

    const startTime = Date.now();
    const result = await client.get('/accounting/accounts', params);
    
    if ('error' in result) {
      return result;
    }

    // The API returns an array directly, not wrapped in a data object
    const data = Array.isArray(result) ? result : (result as any).data || result;
    const meta = buildPaginationMeta(result, page, perpage);

    return {
      ok: true,
      data,
      ...(meta && { page: meta }),
      source: {
        endpoint: '/accounting/accounts',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const getAccountStatementTool = {
  name: 'payday_get_account_statement',
  description: 'Get complete account statement with transaction details. Automatically fetches all pages. REQUIRED: Either both dateFrom/dateTo (journal dates) OR both createdFrom/createdTo (creation dates).',
  inputSchema: getAccountStatementSchema,
  handler: async (
    input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    // Account statement has special pagination limits (testing max 500 per page)
    const page = Math.max(1, input.page || 1);
    const perpage = input.perpage !== undefined ? Math.min(500, Math.max(1, input.perpage)) : 100;

    const params: Record<string, any> = { page, perpage };
    
    // Add optional filters
    if (input.dateFrom) params.dateFrom = input.dateFrom;
    if (input.dateTo) params.dateTo = input.dateTo;
    if (input.createdFrom) params.createdFrom = input.createdFrom;
    if (input.createdTo) params.createdTo = input.createdTo;
    if (input.accountCode) params.accountCode = input.accountCode;
    if (input.accountType) params.accountType = input.accountType;
    if (input.accountSubType) params.accountSubType = input.accountSubType;

    const startTime = Date.now();
    const allData: any[] = [];
    let currentPage = page;
    let requestCount = 0;
    const maxRequests = 100; // Safety limit to prevent infinite loops
    
    // Auto-pagination: fetch all pages
    let totalPages = 0;
    
    while (currentPage <= 1000 && requestCount < maxRequests) { // Max 100,000 items (100 pages * 100 per page)
      const currentParams = { ...params, page: currentPage };
      const result = await client.get('/accounting/accountStatement', currentParams);
      
      if ('error' in result) {
        // If it's the first request, return the error
        if (currentPage === page) {
          return result;
        }
        // If we've already got some data, break and return what we have
        break;
      }

      // Account statement returns object with 'lines' property and pagination metadata
      const response = result as any;
      const pageData = response.lines || [];
      
      // Update total pages from API response
      if (response.pages && totalPages === 0) {
        totalPages = response.pages;
      }
      
      if (!Array.isArray(pageData) || pageData.length === 0) {
        // No more data, stop pagination
        break;
      }
      
      allData.push(...pageData);
      requestCount++;
      
      // Check if we've reached the last page using API metadata
      if (totalPages > 0 && currentPage >= totalPages) {
        break;
      }
      
      // Fallback: if we got less than the requested perpage, we've reached the end
      if (pageData.length < perpage) {
        break;
      }
      
      currentPage++;
    }

    // Calculate response size to help diagnose truncation issues
    const responseSize = JSON.stringify(allData).length;
    
    return {
      ok: true,
      data: allData,
      source: {
        endpoint: '/accounting/accountStatement',
        method: 'GET',
        total_items: allData.length,
        pages_fetched: requestCount,
        total_pages: totalPages,
        duration_ms: Date.now() - startTime,
        response_size_bytes: responseSize,
      },
    };
  },
};