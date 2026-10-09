import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProjectsModule } from '../projects/projects.module';
import { ApplicationsController } from './controllers/applications.controller';
import { ProjectApplicationsController } from './controllers/project-applications.controller';
import { ApplicationReviewService } from './services/application-review.service';
import { ApplicationsService } from './services/applications.service';

@Module({
  imports: [OrganizationsModule, ProjectsModule],
  controllers: [ApplicationsController, ProjectApplicationsController],
  providers: [ApplicationsService, ApplicationReviewService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
