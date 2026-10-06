import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

const validate = (input: Record<string, unknown>) =>
  validateSync(plainToInstance(PaginationQueryDto, input));

describe('PaginationQueryDto', () => {
  it('applies defaults', () => {
    const dto = plainToInstance(PaginationQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('coerces query strings to numbers', () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '2', limit: '50' });
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it.each([{ limit: 101 }, { limit: 0 }, { page: 0 }, { page: 'abc' }])(
    'rejects invalid input %p',
    (input) => {
      expect(validate(input).length).toBeGreaterThan(0);
    },
  );
});
