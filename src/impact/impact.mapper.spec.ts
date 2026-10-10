import { Impact, Prisma } from '@prisma/client';
import { toImpactView } from './impact.mapper';

const row = (over: Partial<Impact> = {}): Impact => ({
  id: 'i1',
  projectId: 'p1',
  volunteersCount: 24,
  hours: new Prisma.Decimal('192.5'),
  activitiesCount: 6,
  beneficiariesCount: 350,
  resources: 'Gloves',
  description: 'Done',
  metrics: { internal: true },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('toImpactView', () => {
  it('converts the exact decimal hours to a plain number and adds the live accepted count', () => {
    const view = toImpactView(row(), 22);
    expect(view.hours).toBe(192.5);
    expect(typeof view.hours).toBe('number');
    expect(view.acceptedVolunteers).toBe(22);
    expect(view.volunteersCount).toBe(24);
  });

  it('keeps two-decimal precision', () => {
    expect(toImpactView(row({ hours: new Prisma.Decimal('0.07') }), 0).hours).toBe(0.07);
    expect(toImpactView(row({ hours: new Prisma.Decimal('9999999.99') }), 0).hours).toBe(
      9999999.99,
    );
  });

  it('does not expose the internal metrics extension column', () => {
    expect(toImpactView(row(), 0)).not.toHaveProperty('metrics');
  });
});
