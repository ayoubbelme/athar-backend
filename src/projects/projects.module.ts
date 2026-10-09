import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ProjectsController } from './controllers/projects.controller';
import { ProjectSkillsService } from './services/project-skills.service';
import { ProjectsService } from './services/projects.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectSkillsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
