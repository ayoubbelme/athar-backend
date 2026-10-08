import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and never returns the plain password', async () => {
    const hash = await service.hash('Str0ngPassw0rd');
    expect(hash).not.toContain('Str0ngPassw0rd');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    expect(await service.hash('Str0ngPassw0rd')).not.toBe(await service.hash('Str0ngPassw0rd'));
  });

  it('verifies correct and incorrect passwords', async () => {
    const hash = await service.hash('Str0ngPassw0rd');
    await expect(service.verify(hash, 'Str0ngPassw0rd')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed verification instead of throwing', async () => {
    await expect(service.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('verifyDummy completes without throwing', async () => {
    await expect(service.verifyDummy('anything')).resolves.toBeUndefined();
  });
});
