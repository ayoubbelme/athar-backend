import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { MyApplicationView, ReviewApplicationView } from '../application.mapper';
import {
  CreateApplicationDto,
  ListProjectApplicationsQueryDto,
  MyApplicationResponseDto,
  ReviewApplicationResponseDto,
} from '../dto/application.dto';
import { ApplicationReviewService } from '../services/application-review.service';
import { ApplicationsService } from '../services/applications.service';

/** Application routes nested under a project: `/projects/:projectId/applications`. */
@ApiTags(API_TAGS.APPLICATIONS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('projects/:projectId/applications')
export class ProjectApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly review: ApplicationReviewService,
  ) {}

  @Post()
  @Roles(Role.VOLUNTEER)
  @ApiOperation({
    summary: 'Apply to a project (VOLUNTEER)',
    description:
      'Only PUBLISHED projects accept applications. One application per volunteer per project; ' +
      'a volunteer who withdrew may apply again.',
  })
  @ApiCreatedResponse({ type: MyApplicationResponseDto })
  @ApiResponse({ status: 403, description: 'Volunteers only', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found', type: ErrorResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Already applied / project not open',
    type: ErrorResponseDto,
  })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateApplicationDto,
  ): Promise<MyApplicationView> {
    return this.applications.apply(user, projectId, dto);
  }

  @Get()
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'List applicants of a project (project owner or ADMIN)',
    description:
      "Includes each applicant's profile and skills. Contact details only once ACCEPTED.",
  })
  @ApiPaginatedResponse(ReviewApplicationResponseDto)
  @ApiResponse({ status: 403, description: 'Not your project', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found', type: ErrorResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListProjectApplicationsQueryDto,
  ): Promise<PaginatedResult<ReviewApplicationView>> {
    return this.review.listForProject(user, projectId, query);
  }
}
