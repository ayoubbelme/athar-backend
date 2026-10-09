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
import { UserResponseDto } from '../dto/user-response.dto';
import { ListUsersQueryDto, UpdateMeDto, UpdateUserStatusDto } from '../dto/users.dto';
import { UsersAdminService } from '../services/users-admin.service';
import { PublicUser, UsersService } from '../users.service';

@ApiTags(API_TAGS.USERS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly admin: UsersAdminService,
  ) {}

  // NOTE: `me` is declared before `:id` so "me" is never parsed as an id.
  @Patch('me')
  @ApiOperation({ summary: 'Update my account name' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto): Promise<PublicUser> {
    return this.users.updateName(user.id, dto.name);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List / search / filter users (ADMIN)' })
  @ApiPaginatedResponse(UserResponseDto)
  @ApiResponse({ status: 403, description: 'Admin only', type: ErrorResponseDto })
  list(@Query() query: ListUsersQueryDto): Promise<PaginatedResult<PublicUser>> {
    return this.admin.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a user (ADMIN)' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiResponse({ status: 403, description: 'Admin only', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'User not found', type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.admin.findOne(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Suspend or reactivate a user (ADMIN)',
    description:
      "Suspending revokes all of the user's sessions immediately. You cannot change your own status.",
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiResponse({ status: 403, description: 'Admin only / own account', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'User not found', type: ErrorResponseDto })
  updateStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<PublicUser> {
    return this.admin.updateStatus(actor.id, id, dto.status);
  }
}
