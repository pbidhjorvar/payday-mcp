import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { createJournalEntrySchema, updateJournalEntrySchema, getJournalEntriesSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const createJournalEntryTool = {
  name: 'payday_create_journal_entry',
  description: 'Create a journal entry in the accounting system. Each line must have exactly one of: ledgerAccountId, customerId, or creditorId.',
  inputSchema: createJournalEntrySchema,
  handler: async (
    input: any,
    _profileName: string,
    profile: Profile,
    client: PaydayClient
  ) => {
    // Debug logging for journal entry creation (only when DEBUG=1)
    if (process.env.DEBUG === '1') {
      console.error('[JOURNAL] Input lines type:', typeof input.lines);
      console.error('[JOURNAL] Is input.lines array?:', Array.isArray(input.lines));
      console.error('[JOURNAL] Lines count:', Array.isArray(input.lines) ? input.lines.length : 'N/A');
    }
    
    // Check read-only mode
    if (profile.read_only) {
      return {
        ok: false,
        error: {
          status: 403,
          label: 'READ_ONLY_MODE',
          detail: 'Journal entry creation is not allowed in read-only mode',
        },
      };
    }

    const startTime = Date.now();
    
    // Build request body
    const requestBody: any = {
      date: input.date,
      description: input.description,
      lines: input.lines,
      status: input.status || 'DRAFT', // Default to DRAFT if not specified
    };
    
    if (process.env.DEBUG === '1') {
      console.error('[JOURNAL] Request body to send:', JSON.stringify(requestBody, null, 2));
    }

    const result = await client.post('/accounting/journal', requestBody);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: '/accounting/journal',
        method: 'POST',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const updateJournalEntryTool = {
  name: 'payday_update_journal_entry',
  description: 'Update a journal entry (currently only supports posting draft entries)',
  inputSchema: updateJournalEntrySchema,
  handler: async (
    input: any,
    _profileName: string,
    profile: Profile,
    client: PaydayClient
  ) => {
    // Check read-only mode
    if (profile.read_only) {
      return {
        ok: false,
        error: {
          status: 403,
          label: 'READ_ONLY_MODE',
          detail: 'Journal entry updates are not allowed in read-only mode',
        },
      };
    }

    const startTime = Date.now();
    
    // Build request body
    const requestBody = {
      status: input.status,
    };

    const result = await client.put(`/accounting/journal/${input.journalId}`, requestBody);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: `/accounting/journal/${input.journalId}`,
        method: 'PUT',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const getJournalEntriesTool = {
  name: 'payday_get_journal_entries',
  description: 'Get journal entries with pagination',
  inputSchema: getJournalEntriesSchema,
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
    const result = await client.get('/accounting/journal', params);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;
    const meta = buildPaginationMeta(result, page, perpage);

    return {
      ok: true,
      data,
      ...(meta && { page: meta }),
      source: {
        endpoint: '/accounting/journal',
        duration_ms: Date.now() - startTime,
      },
    };
  },
};