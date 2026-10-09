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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { MyApplicationView, ReviewApplicationView } from '../application.mapper';
import {
  ListMyApplicationsQueryDto,
  MyApplicationResponseDto,
  ReviewApplicationResponseDto,
  UpdateApplicationStatusDto,
} from '../dto/application.dto';
import { ApplicationReviewService } from '../services/application-review.service';
import { ApplicationsService } from '../services/applications.service';

@ApiTags(API_TAGS.APPLICATIONS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly review: ApplicationReviewService,
  ) {}

  @Get('my')
  @Roles(Role.VOLUNTEER)
  @ApiOperation({ summary: 'List my applications (VOLUNTEER)' })
  @ApiPaginatedResponse(MyApplicationResponseDto)
  @ApiResponse({ status: 403, description: 'Volunteers only', type: ErrorResponseDto })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyApplicationsQueryDto,
  ): Promise<PaginatedResult<MyApplicationView>> {
    return this.applications.listMine(user, query);
  }

  @Patch(':id/status')
  @Roles(Role.ORGANIZATION, Role.ADMIN)
  @ApiOperation({
    summary: 'Accept or reject an application (project owner or ADMIN)',
    description:
      'Allowed transitions: PENDING→ACCEPTED|REJECTED, ACCEPTED→REJECTED. REJECTED is final. ' +
      "Accepting is refused once `maxVolunteers` is reached. The applicant's contact details are " +
      'revealed in the response once ACCEPTED.',
  })
  @ApiOkResponse({ type: ReviewApplicationResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Status must be ACCEPTED or REJECTED',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Application not found (or not yours)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Invalid transition / project full / project closed',
    type: ErrorResponseDto,
  })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ): Promise<ReviewApplicationView> {
    return this.review.updateStatus(user, id, dto.status);
  }

  @Delete(':id')
  @Roles(Role.VOLUNTEER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Withdraw my application (VOLUNTEER)',
    description:
      'Sets the status to WITHDRAWN (history is kept). Idempotent. You may apply again later; ' +
      'the same application is reactivated as PENDING.',
  })
  @ApiNoContentResponse({ description: 'Withdrawn' })
  @ApiResponse({
    status: 404,
    description: 'Application not found (or not yours)',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Cannot withdraw (rejected / project closed)',
    type: ErrorResponseDto,
  })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.applications.withdraw(user, id);
  }
}
