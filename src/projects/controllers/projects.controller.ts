import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { API_TAGS, BEARER_AUTH_NAME } from '../../common/constants';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponseDto,
  ReplaceProjectSkillsDto,
  UpdateProjectDto,
} from '../dto/project.dto';
import { ProjectView, ProjectsService } from '../services/projects.service';

@ApiTags(API_TAGS.PROJECTS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @Roles(Role.ORGANIZATION)
  @ApiOperation({
    summary: 'Create a project (ORGANIZATION)',
    description:
      "The project is owned by the caller's organization. Starts as DRAFT unless `status: PUBLISHED` is sent. " +
      'Required skills can be supplied inline.',
  })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Organizations only', type: ErrorResponseDto })
  @ApiResponse({
    status: 422,
    description: 'Invalid dates or unknown skill',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectView> {
    return this.projects.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List / search / filter projects',
    description:
      'Volunteers see public projects only. Organizations also see their own drafts. Admins see everything.',
  })
  @ApiPaginatedResponse(ProjectResponseDto)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProjectsQueryDto,
  ): Promise<PaginatedResult<ProjectView>> {
    return this.projects.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project with its organization and required skills' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Not found (or not visible to you)',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectView> {
    return this.projects.findOne(user, id);
  }

  @Patch(':id')
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'Update a project (owner or ADMIN)',
    description:
      'Partial update, also used to move the project through its lifecycle via `status`. ' +
      'COMPLETED and CANCELLED projects are read-only.',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: 'Not your project', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found', type: ErrorResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Invalid status transition / project is final',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: 422, description: 'endDate before startDate', type: ErrorResponseDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectView> {
    return this.projects.update(user, id, dto);
  }

  @Put(':id/skills')
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'Replace the required skills of a project (owner or ADMIN)',
    description:
      'Sends the complete set; `[]` removes all requirements. `importance` (1–5) weights matching.',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: 'Not your project', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Project is final', type: ErrorResponseDto })
  @ApiResponse({ status: 422, description: 'Unknown skill', type: ErrorResponseDto })
  replaceSkills(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceProjectSkillsDto,
  ): Promise<ProjectView> {
    return this.projects.replaceSkills(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a project (owner: drafts only; ADMIN: any)',
    description:
      'Published projects must be cancelled instead, which preserves applications and impact data.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiResponse({ status: 403, description: 'Not your project', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Only drafts can be deleted', type: ErrorResponseDto })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.projects.remove(user, id);
  }
}
