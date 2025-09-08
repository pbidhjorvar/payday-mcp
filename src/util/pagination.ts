export interface PaginationParams {
  page?: number;
  perpage?: number;
}

export interface PaginationMeta {
  page: number;
  perpage: number;
  total: number;
  has_next: boolean;
}

export function validatePagination(params: PaginationParams): { page: number; perpage: number } {
  const page = Math.max(1, params.page || 1);
  const perpage = params.perpage !== undefined ? Math.min(500, Math.max(1, params.perpage)) : 50;
  
  return { page, perpage };
}

export function buildPaginationMeta(
  data: any,
  page: number,
  perpage: number
): PaginationMeta | undefined {
  if (!data?.meta) return undefined;
  
  return {
    page: data.meta.current_page || page,
    perpage: data.meta.per_page || perpage,
    total: data.meta.total || 0,
    has_next: data.meta.current_page < data.meta.last_page,
  };
}