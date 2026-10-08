import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  /** Computed once; used to keep login timing equal for unknown emails. */
  private dummyHash?: Promise<string>;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false; // malformed hash must never crash a login
    }
  }

  /**
   * Burns the same CPU as a real verification. Called when the email does not exist so
   * response time does not reveal which emails are registered.
   */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHash ??= this.hash('athar-timing-equalizer');
    await this.verify(await this.dummyHash, plain);
  }
}
