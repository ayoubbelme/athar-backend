import { Module } from '@nestjs/common';
import { VolunteersController } from './controllers/volunteers.controller';
import { VolunteerSkillsService } from './services/volunteer-skills.service';
import { VolunteersService } from './services/volunteers.service';

@Module({
  controllers: [VolunteersController],
  providers: [VolunteersService, VolunteerSkillsService],
  exports: [VolunteersService, VolunteerSkillsService],
})
export class VolunteersModule {}
