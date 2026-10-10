import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateImpactDto, UpdateImpactDto } from './impact.dto';

const errors = <T extends object>(cls: new () => T, input: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(cls, input)).map((e) => e.property);

describe('impact DTO validation', () => {
  it('accepts a complete valid report and an empty one (everything is optional on create)', () => {
    expect(
      errors(CreateImpactDto, {
        volunteersCount: 24,
        hours: 192.5,
        activitiesCount: 6,
        beneficiariesCount: 350,
        resources: '  Gloves  ',
        description: 'Cleaned 4 spaces',
      }),
    ).toEqual([]);
    expect(errors(CreateImpactDto, {})).toEqual([]);
  });

  it.each([
    ['negative volunteers', { volunteersCount: -1 }, 'volunteersCount'],
    ['fractional volunteers', { volunteersCount: 1.5 }, 'volunteersCount'],
    ['volunteers over the cap', { volunteersCount: 1_000_001 }, 'volunteersCount'],
    ['negative hours', { hours: -0.5 }, 'hours'],
    ['three decimal places', { hours: 1.234 }, 'hours'],
    ['hours over the cap', { hours: 10_000_000 }, 'hours'],
    ['hours as a string', { hours: '12' }, 'hours'],
    ['hours NaN', { hours: Number.NaN }, 'hours'],
    ['negative activities', { activitiesCount: -3 }, 'activitiesCount'],
    [
      'beneficiaries over the integer range',
      { beneficiariesCount: 2_000_000_000 },
      'beneficiariesCount',
    ],
    ['resources too long', { resources: 'x'.repeat(2001) }, 'resources'],
    ['description too long', { description: 'x'.repeat(5001) }, 'description'],
  ])('rejects %s', (_label, input, property) => {
    expect(errors(CreateImpactDto, input)).toContain(property);
    expect(errors(UpdateImpactDto, input)).toContain(property);
  });

  it('rejects an infinite number', () => {
    expect(errors(CreateImpactDto, { hours: Infinity })).toContain('hours');
  });

  describe('update semantics', () => {
    it('allows omitting everything', () => {
      expect(errors(UpdateImpactDto, {})).toEqual([]);
    });

    it('allows null only for the optional text fields', () => {
      expect(errors(UpdateImpactDto, { resources: null, description: null })).toEqual([]);
      for (const field of ['volunteersCount', 'hours', 'activitiesCount', 'beneficiariesCount']) {
        expect(errors(UpdateImpactDto, { [field]: null })).toContain(field);
      }
    });

    it('accepts zero as a legitimate value', () => {
      expect(
        errors(UpdateImpactDto, {
          volunteersCount: 0,
          hours: 0,
          activitiesCount: 0,
          beneficiariesCount: 0,
        }),
      ).toEqual([]);
    });
  });
});
