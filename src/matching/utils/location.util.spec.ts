import { locationTokens, locationsMatch } from './location.util';

describe('location util', () => {
  it('tokenizes: lower-case, accents removed, split on , ; / |', () => {
    expect([...locationTokens('  Béjaïa ; Algiers / Oran  ')].sort()).toEqual([
      'algiers',
      'bejaia',
      'oran',
    ]);
    expect(locationTokens(null).size).toBe(0);
    expect(locationTokens('  ,  ').size).toBe(0);
  });

  it.each([
    ['Algiers', 'algiers'],
    ['Algiers, Algeria', 'ALGIERS'],
    ['Béjaïa', 'Bejaia'],
    ['Oran / Es Senia', 'es  senia'],
  ])('%p matches %p', (a, b) => {
    expect(locationsMatch(a, b)).toBe(true);
  });

  it.each([
    ['Algiers', 'Oran'],
    ['Algiers', 'Alger'], // no fuzzy matching: predictable and explainable
    ['Algiers', null],
    [null, 'Algiers'],
    ['', ''],
  ])('%p does not match %p', (a, b) => {
    expect(locationsMatch(a, b)).toBe(false);
  });
});
