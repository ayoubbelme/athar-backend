import { Module } from '@nestjs/common';
import { MatchingController } from './controllers/matching.controller';
import { MATCH_STRATEGY } from './interfaces/match.interfaces';
import { MatchingService } from './services/matching.service';
import { RuleBasedMatchStrategy } from './strategies/rule-based-match.strategy';

@Module({
  controllers: [MatchingController],
  providers: [
    MatchingService,
    // To switch algorithms (e.g. an ML-backed strategy), change only this binding.
    { provide: MATCH_STRATEGY, useClass: RuleBasedMatchStrategy },
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
