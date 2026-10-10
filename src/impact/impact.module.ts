import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProjectsModule } from '../projects/projects.module';
import { ImpactStatsController } from './controllers/impact-stats.controller';
import { ProjectImpactController } from './controllers/project-impact.controller';
import { ImpactStatsService } from './services/impact-stats.service';
import { ImpactService } from './services/impact.service';

@Module({
  imports: [ProjectsModule, OrganizationsModule],
  controllers: [ProjectImpactController, ImpactStatsController],
  providers: [ImpactService, ImpactStatsService],
  exports: [ImpactService, ImpactStatsService],
})
export class ImpactModule {}
