import { describe, it, expect } from 'vitest';
import { validatePagination, buildPaginationMeta } from '../util/pagination.js';

describe('Pagination', () => {
  describe('validatePagination', () => {
    it('should use default values when not provided', () => {
      const result = validatePagination({});
      
      expect(result).toEqual({
        page: 1,
        perpage: 50,
      });
    });

    it('should enforce minimum page number', () => {
      const result = validatePagination({ page: -1, perpage: 25 });
      
      expect(result).toEqual({
        page: 1,
        perpage: 25,
      });
    });

    it('should enforce maximum perpage limit', () => {
      const result = validatePagination({ page: 2, perpage: 1000 });
      
      expect(result).toEqual({
        page: 2,
        perpage: 500,
      });
    });

    it('should enforce minimum perpage limit', () => {
      const result = validatePagination({ page: 1, perpage: 0 });
      
      expect(result).toEqual({
        page: 1,
        perpage: 1,
      });
    });
  });

  describe('buildPaginationMeta', () => {
    it('should build pagination meta from API response', () => {
      const apiResponse = {
        data: [],
        meta: {
          current_page: 2,
          per_page: 25,
          total: 100,
          last_page: 4,
        },
      };

      const result = buildPaginationMeta(apiResponse, 2, 25);

      expect(result).toEqual({
        page: 2,
        perpage: 25,
        total: 100,
        has_next: true,
      });
    });

    it('should handle last page correctly', () => {
      const apiResponse = {
        data: [],
        meta: {
          current_page: 4,
          per_page: 25,
          total: 100,
          last_page: 4,
        },
      };

      const result = buildPaginationMeta(apiResponse, 4, 25);

      expect(result).toEqual({
        page: 4,
        perpage: 25,
        total: 100,
        has_next: false,
      });
    });

    it('should return undefined when no meta in response', () => {
      const apiResponse = { data: [] };

      const result = buildPaginationMeta(apiResponse, 1, 50);

      expect(result).toBeUndefined();
    });

    it('should use fallback values when meta fields are missing', () => {
      const apiResponse = {
        data: [],
        meta: {
          last_page: 1,
        },
      };

      const result = buildPaginationMeta(apiResponse, 1, 50);

      expect(result).toEqual({
        page: 1,
        perpage: 50,
        total: 0,
        has_next: false,
      });
    });
  });
});