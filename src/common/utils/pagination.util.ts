import { PaginatedResult } from '../dto/paginated-response.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

/** Converts page/limit into Prisma `skip`/`take`. */
export function toPrismaPagination({ page, limit }: PaginationQueryDto): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * limit, take: limit };
}

/** Builds the standard `{ data, meta }` envelope used by every list endpoint. */
export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  { page, limit }: Pick<PaginationQueryDto, 'page' | 'limit'>,
): PaginatedResult<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}
