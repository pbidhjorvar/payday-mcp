import { PaydayClient } from '../http/paydayClient.js';
import { Profile } from '../config/profiles.js';
import { getInvoicesSchema, getInvoiceSchema, updateInvoiceSchema } from '../types/schemas.js';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

export const getInvoicesTool = {
  name: 'payday_get_invoices',
  description: 'Get invoices with optional filtering by excludeStatus, date ranges (invoice, due, final due), query search, and sorting',
  inputSchema: getInvoicesSchema,
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
    
    // Add optional filters
    if (input.excludeStatus) params.excludeStatus = input.excludeStatus;
    if (input.dateFrom) params.dateFrom = input.dateFrom;
    if (input.dateTo) params.dateTo = input.dateTo;
    if (input.dueDateFrom) params.dueDateFrom = input.dueDateFrom;
    if (input.dueDateTo) params.dueDateTo = input.dueDateTo;
    if (input.finalDueDateFrom) params.finalDueDateFrom = input.finalDueDateFrom;
    if (input.finalDueDateTo) params.finalDueDateTo = input.finalDueDateTo;
    if (input.query) params.query = input.query;
    if (input.order) params.order = input.order;
    if (input.orderBy) params.orderBy = input.orderBy;
    if (input.include && input.include.length > 0) {
      params.include = input.include;
    }
    
    // Legacy parameter support
    if (input.from && !input.dateFrom) params.dateFrom = input.from;
    if (input.to && !input.dateTo) params.dateTo = input.to;

    // Determine endpoint based on customer_id
    const endpoint = input.customer_id
      ? `/customers/${input.customer_id}/invoices`
      : '/invoices';

    const startTime = Date.now();
    const result = await client.get(endpoint, params);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;
    const meta = buildPaginationMeta(result, page, perpage);

    // Create user-friendly summary
    const invoices = Array.isArray(data) ? data : [];
    const summary = generateInvoiceSummary(invoices);

    return {
      ok: true,
      data,
      summary,
      ...(meta && { page: meta }),
      source: {
        endpoint,
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const getInvoiceTool = {
  name: 'payday_get_invoice',
  description: 'Get a single invoice by number or UUID with optional includes (e.g., lines)',
  inputSchema: getInvoiceSchema,
  handler: async (
    input: any,
    _profileName: string,
    _profile: Profile,
    client: PaydayClient
  ) => {
    const startTime = Date.now();
    
    // Convert invoice number to UUID if needed
    let invoiceUuid = input.invoice_id;
    
    // Check if input looks like a UUID (contains dashes) or a number
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.invoice_id)) {
      // Not a UUID, assume it's an invoice number - need to look it up
      const invoiceListResult = await client.get('/invoices', { perpage: 500 });
      
      if ('error' in invoiceListResult) {
        return invoiceListResult;
      }
      
      const invoiceData = (invoiceListResult as any).invoices || (invoiceListResult as any).data || invoiceListResult;
      const invoice = invoiceData.find((inv: any) => 
        inv.number?.toString() === input.invoice_id.toString()
      );
      
      if (!invoice) {
        return {
          ok: false,
          error: {
            status: 404,
            label: 'INVOICE_NOT_FOUND',
            detail: `Invoice with number ${input.invoice_id} not found`,
          },
        };
      }
      
      invoiceUuid = invoice.id;
    }

    // Build query parameters
    const params: Record<string, any> = {};
    if (input.include && input.include.length > 0) {
      params.include = input.include;
    }

    const result = await client.get(`/invoices/${invoiceUuid}`, params);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: `/invoices/${invoiceUuid}`,
        method: 'GET',
        invoice_number: input.invoice_id,
        invoice_uuid: invoiceUuid,
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

export const updateInvoiceTool = {
  name: 'payday_update_invoice',
  description: 'Update invoice - supports 6 modes: mark as paid, resend email, cancel claim, payment extension, cancel invoice, update draft',
  inputSchema: updateInvoiceSchema,
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
          detail: 'Invoice updates are not allowed in read-only mode',
        },
      };
    }

    const startTime = Date.now();
    
    // Convert invoice number to UUID if needed
    let invoiceUuid = input.invoice_id;
    
    // Check if input looks like a UUID (contains dashes) or a number
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.invoice_id)) {
      // Not a UUID, assume it's an invoice number - need to look it up
      const invoiceListResult = await client.get('/invoices', { perpage: 500 });
      
      if ('error' in invoiceListResult) {
        return invoiceListResult;
      }
      
      const invoiceData = (invoiceListResult as any).invoices || (invoiceListResult as any).data || invoiceListResult;
      const invoice = invoiceData.find((inv: any) => 
        inv.number?.toString() === input.invoice_id.toString()
      );
      
      if (!invoice) {
        return {
          ok: false,
          error: {
            status: 404,
            label: 'INVOICE_NOT_FOUND',
            detail: `Invoice with number ${input.invoice_id} not found`,
          },
        };
      }
      
      invoiceUuid = invoice.id;
    }
    
    // Build request body based on mode
    let requestBody: any = {};
    
    switch (input.mode) {
      case 'mark_as_paid':
        requestBody = {
          status: 'PAID',
          paidDate: input.paidDate || new Date().toISOString(),
          paymentType: input.paymentType,
        };
        break;
      
      case 'resend_email':
        requestBody = {
          status: 'SENT',
        };
        break;
      
      case 'cancel_claim':
        // Cancel claim logic (you may need to adjust based on API requirements)
        requestBody = {
          cancelClaim: true,
        };
        break;
      
      case 'payment_extension':
        // Payment extension logic
        requestBody = {
          paymentExtension: true,
        };
        break;
      
      case 'cancel_invoice':
        requestBody = {
          status: 'CANCELLED',
        };
        break;
      
      case 'update_draft':
        if (!input.draftData) {
          return {
            ok: false,
            error: {
              status: 400,
              label: 'VALIDATION_ERROR',
              detail: 'draftData is required for update_draft mode',
            },
          };
        }
        requestBody = input.draftData;
        break;
      
      default:
        return {
          ok: false,
          error: {
            status: 400,
            label: 'VALIDATION_ERROR',
            detail: 'Invalid mode specified',
          },
        };
    }

    // Override with any explicitly provided fields
    if (input.status) requestBody.status = input.status;
    if (input.paidDate) requestBody.paidDate = input.paidDate;
    if (input.paymentType) requestBody.paymentType = input.paymentType;

    const result = await client.put(`/invoices/${invoiceUuid}`, requestBody);
    
    if ('error' in result) {
      return result;
    }

    const data = (result as any).data || result;

    return {
      ok: true,
      data,
      source: {
        endpoint: `/invoices/${invoiceUuid}`,
        method: 'PUT',
        mode: input.mode,
        invoice_number: input.invoice_id,
        invoice_uuid: invoiceUuid,
        duration_ms: Date.now() - startTime,
      },
    };
  },
};

// Helper function to generate user-friendly invoice summary
function generateInvoiceSummary(invoices: any[]) {
  if (invoices.length === 0) {
    return {
      total_items: 0,
      message: "No invoices found",
      suggestion: "Try adjusting your filters or date range"
    };
  }

  const statusCounts = invoices.reduce((acc, inv) => {
    const status = inv.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalValue = invoices.reduce((sum, inv) => {
    return sum + (parseFloat(inv.total) || 0);
  }, 0);

  const avgValue = totalValue / invoices.length;
  
  const mostRecent = invoices.sort((a, b) => 
    new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime()
  )[0];

  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');

  const insights = [];
  if (statusCounts.OVERDUE > 0) {
    insights.push(`${statusCounts.OVERDUE} invoices are overdue and need attention`);
  }
  if (statusCounts.SENT > 0) {
    insights.push(`${statusCounts.SENT} invoices are awaiting payment`);
  }
  if (avgValue > 1000) {
    insights.push(`High average value: ${avgValue.toFixed(0)} ${invoices[0]?.currency || 'ISK'}`);
  }

  return {
    total_items: invoices.length,
    total_value: totalValue,
    average_value: Math.round(avgValue),
    currency: invoices[0]?.currency || 'ISK',
    status_breakdown: statusSummary,
    key_insights: insights,
    most_recent: mostRecent ? {
      number: mostRecent.number,
      customer: mostRecent.customer?.name,
      created: mostRecent.created
    } : null,
    quick_actions: [
      "Add status='OVERDUE' to see only overdue invoices",
      "Use include=['lines'] to see invoice line items",
      "Add from='2025-01-01' to filter by date range"
    ]
  };
}