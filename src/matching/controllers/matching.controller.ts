import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { API_TAGS, BEARER_AUTH_NAME } from '../../common/constants';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  ProjectMatchDto,
  RecommendationsQueryDto,
  RecommendedProjectDto,
} from '../dto/matching.dto';
import { MatchingService, ProjectMatch, RecommendedProject } from '../services/matching.service';

@ApiTags(API_TAGS.MATCHING)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@ApiResponse({ status: 403, description: 'Volunteers only', type: ErrorResponseDto })
@Roles(Role.VOLUNTEER)
@Controller('matching')
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get('projects')
  @ApiOperation({
    summary: 'Recommended projects for me (VOLUNTEER)',
    description:
      'Open projects ranked by match score (best first). Excludes projects you already applied to, ' +
      'full projects and projects that have ended. Each item explains its score. ' +
      'Improve your results by completing your skills, location, interests and availability.',
  })
  @ApiPaginatedResponse(RecommendedProjectDto)
  recommend(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecommendationsQueryDto,
  ): Promise<PaginatedResult<RecommendedProject>> {
    return this.matching.recommend(user, query);
  }

  @Get('projects/:id')
  @ApiOperation({
    summary: 'How well do I match this project? (VOLUNTEER)',
    description:
      'Score 0–100 with matched/missing skills and per-component explanation. ' +
      'Components a project does not specify are ignored (`null`) and the weights re-normalized.',
  })
  @ApiOkResponse({ type: ProjectMatchDto })
  @ApiResponse({
    status: 404,
    description: 'Project not found / not visible',
    type: ErrorResponseDto,
  })
  matchProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectMatch> {
    return this.matching.matchWithProject(user, id);
  }
}
