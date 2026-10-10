import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { API_TAGS, BEARER_AUTH_NAME } from '../../common/constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateImpactDto, ImpactResponseDto, UpdateImpactDto } from '../dto/impact.dto';
import { ImpactView } from '../impact.mapper';
import { ImpactService } from '../services/impact.service';

@ApiTags(API_TAGS.IMPACT)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('projects/:projectId/impact')
export class ProjectImpactController {
  constructor(private readonly impact: ImpactService) {}

  @Post()
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'Record the impact of a project (owner or ADMIN)',
    description:
      'Only for projects that are IN_PROGRESS or COMPLETED; one record per project. ' +
      '`volunteersCount` defaults to the number of ACCEPTED applications.',
  })
  @ApiCreatedResponse({ type: ImpactResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Not your project', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Project not found', type: ErrorResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Already recorded / project not in progress or completed',
    type: ErrorResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateImpactDto,
  ): Promise<ImpactView> {
    return this.impact.create(user, projectId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get the impact of a project',
    description: 'Visible to anyone who can see the project (impact is a showcase of results).',
  })
  @ApiOkResponse({ type: ImpactResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Project not found, or no impact recorded yet',
    type: ErrorResponseDto,
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ImpactView> {
    return this.impact.findForProject(user, projectId);
  }

  @Patch()
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'Update the impact of a project (owner or ADMIN)',
    description:
      'Partial update. Allowed after the project is COMPLETED, so reports can be corrected.',
  })
  @ApiOkResponse({ type: ImpactResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Not your project', type: ErrorResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Project not found, or no impact recorded yet',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Project is not in progress or completed',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateImpactDto,
  ): Promise<ImpactView> {
    return this.impact.update(user, projectId, dto);
  }
}
