import { ApplicationStatus, Role } from '@prisma/client';
import { toReviewApplicationView } from './application.mapper';

const row = (status: ApplicationStatus) =>
  ({
    id: 'a1',
    projectId: 'p1',
    status,
    matchScore: 80,
    message: 'hi',
    createdAt: new Date(),
    updatedAt: new Date(),
    volunteer: {
      id: 'v1',
      name: 'Vol',
      email: 'vol@example.com',
      location: 'Algiers',
      volunteerProfile: {
        bio: 'bio',
        phone: '+213 555 000 000',
        experience: 'exp',
        availability: ['WEEKENDS'],
        interests: ['HEALTH'],
      },
      skills: [{ proficiency: 'EXPERT', skill: { id: 's1', name: 'First Aid' } }],
    },
  }) as unknown as Parameters<typeof toReviewApplicationView>[0];

describe('toReviewApplicationView (contact privacy)', () => {
  it.each([ApplicationStatus.PENDING, ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN])(
    'hides email and phone from organizations while %s',
    (status) => {
      const view = toReviewApplicationView(row(status), Role.ORGANIZATION);
      expect(view.volunteer.contact).toBeNull();
      expect(JSON.stringify(view)).not.toContain('vol@example.com');
      expect(JSON.stringify(view)).not.toContain('555');
    },
  );

  it('reveals contact details to the organization once ACCEPTED', () => {
    const view = toReviewApplicationView(row(ApplicationStatus.ACCEPTED), Role.ORGANIZATION);
    expect(view.volunteer.contact).toEqual({ email: 'vol@example.com', phone: '+213 555 000 000' });
  });

  it('always reveals contact details to admins', () => {
    expect(
      toReviewApplicationView(row(ApplicationStatus.PENDING), Role.ADMIN).volunteer.contact,
    ).not.toBeNull();
  });

  it('exposes profile and skills with proficiency', () => {
    const view = toReviewApplicationView(row(ApplicationStatus.PENDING), Role.ORGANIZATION);
    expect(view.volunteer).toMatchObject({
      name: 'Vol',
      bio: 'bio',
      experience: 'exp',
      availability: ['WEEKENDS'],
      interests: ['HEALTH'],
      skills: [{ id: 's1', name: 'First Aid', proficiency: 'EXPERT' }],
    });
  });
});
