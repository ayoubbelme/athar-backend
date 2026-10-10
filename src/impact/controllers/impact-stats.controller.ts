import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { API_TAGS, BEARER_AUTH_NAME } from '../../common/constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrganizationsService } from '../../organizations/services/organizations.service';
import {
  OrganizationImpactStatsDto,
  OrganizationStatsQueryDto,
  PlatformImpactStatsDto,
} from '../dto/impact.dto';
import {
  ImpactStatsService,
  OrganizationImpactStats,
  PlatformImpactStats,
} from '../services/impact-stats.service';

@ApiTags(API_TAGS.IMPACT)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('impact')
export class ImpactStatsController {
  constructor(
    private readonly stats: ImpactStatsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get('organization')
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'Impact statistics of an organization',
    description:
      'ORGANIZATION: always your own projects only. ADMIN: pass `organizationId`. ' +
      'Totals exclude cancelled projects.',
  })
  @ApiOkResponse({ type: OrganizationImpactStatsDto })
  @ApiResponse({
    status: 400,
    description: 'Admins must pass organizationId',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Organizations cannot query other organizations',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Organization not found', type: ErrorResponseDto })
  async organization(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: OrganizationStatsQueryDto,
  ): Promise<OrganizationImpactStats> {
    if (user.role === Role.ADMIN) {
      if (!query.organizationId) {
        throw new BadRequestException('organizationId is required for administrators');
      }
      return this.stats.forOrganization(query.organizationId);
    }

    const own = await this.organizations.findIdByUserId(user.id);
    if (!own) throw new ForbiddenException('Organization profile not found');
    if (query.organizationId && query.organizationId !== own) {
      throw new ForbiddenException('You can only view statistics of your own organization');
    }
    return this.stats.forOrganization(own);
  }

  @Get('platform')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Platform-wide impact statistics (ADMIN)',
    description:
      'Aggregates every organization. Cancelled projects are excluded from impact totals.',
  })
  @ApiOkResponse({ type: PlatformImpactStatsDto })
  @ApiResponse({ status: 403, description: 'Admin only', type: ErrorResponseDto })
  platform(): Promise<PlatformImpactStats> {
    return this.stats.forPlatform();
  }
}
