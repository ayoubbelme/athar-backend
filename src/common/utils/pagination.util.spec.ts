import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { buildPaginatedResult, toPrismaPagination } from './pagination.util';

const query = (page: number, limit: number): PaginationQueryDto =>
  Object.assign(new PaginationQueryDto(), { page, limit });

describe('pagination util', () => {
  it('converts page/limit to skip/take', () => {
    expect(toPrismaPagination(query(1, 20))).toEqual({ skip: 0, take: 20 });
    expect(toPrismaPagination(query(3, 10))).toEqual({ skip: 20, take: 10 });
  });

  it('builds the standard envelope with totalPages', () => {
    const result = buildPaginatedResult(['a', 'b'], 41, { page: 2, limit: 20 });
    expect(result).toEqual({
      data: ['a', 'b'],
      meta: { page: 2, limit: 20, total: 41, totalPages: 3 },
    });
  });

  it('reports at least one page when empty', () => {
    expect(buildPaginatedResult([], 0, { page: 1, limit: 20 }).meta.totalPages).toBe(1);
  });
});
