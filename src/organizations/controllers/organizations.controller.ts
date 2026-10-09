import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
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
  ListOrganizationsQueryDto,
  OrganizationResponseDto,
  UpdateOrganizationProfileDto,
} from '../dto/organization.dto';
import { OrganizationsService } from '../services/organizations.service';

@ApiTags(API_TAGS.ORGANIZATIONS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Browse organizations (any authenticated user)' })
  @ApiPaginatedResponse(OrganizationResponseDto)
  list(
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<PaginatedResult<OrganizationResponseDto>> {
    return this.organizations.list(query);
  }

  // NOTE: `me` routes are declared before `:id` so "me" is never parsed as an id.
  @Get('me')
  @Roles(Role.ORGANIZATION)
  @ApiOperation({ summary: 'Get my organization profile (ORGANIZATION)' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiResponse({ status: 403, description: 'Organizations only', type: ErrorResponseDto })
  getMine(@CurrentUser() user: AuthenticatedUser): Promise<OrganizationResponseDto> {
    return this.organizations.getMyProfile(user.id);
  }

  @Patch('me')
  @Roles(Role.ORGANIZATION)
  @ApiOperation({
    summary: 'Update my organization profile (ORGANIZATION)',
    description: 'Partial update. Send `null` to clear an optional field.',
  })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Organizations only', type: ErrorResponseDto })
  updateMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateOrganizationProfileDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizations.updateMyProfile(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization profile (any authenticated user)' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiResponse({ status: 404, description: 'Organization not found', type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto> {
    return this.organizations.findById(id);
  }
}
