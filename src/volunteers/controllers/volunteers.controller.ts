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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  AddUserSkillDto,
  UpdateUserSkillDto,
  UpdateVolunteerProfileDto,
  UserSkillResponseDto,
  VolunteerProfileResponseDto,
} from '../dto/volunteer.dto';
import { UserSkillView, VolunteerSkillsService } from '../services/volunteer-skills.service';
import { VolunteersService } from '../services/volunteers.service';

@ApiTags(API_TAGS.VOLUNTEERS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@ApiResponse({ status: 403, description: 'Volunteers only', type: ErrorResponseDto })
@Roles(Role.VOLUNTEER)
@Controller('volunteers/me')
export class VolunteersController {
  constructor(
    private readonly volunteers: VolunteersService,
    private readonly volunteerSkills: VolunteerSkillsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get my volunteer profile' })
  @ApiOkResponse({ type: VolunteerProfileResponseDto })
  getProfile(@CurrentUser() user: AuthenticatedUser): Promise<VolunteerProfileResponseDto> {
    return this.volunteers.getMyProfile(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update my volunteer profile',
    description: 'Partial update. Send `null` to clear a field.',
  })
  @ApiOkResponse({ type: VolunteerProfileResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed', type: ErrorResponseDto })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateVolunteerProfileDto,
  ): Promise<VolunteerProfileResponseDto> {
    return this.volunteers.updateMyProfile(user.id, dto);
  }

  @Get('skills')
  @ApiOperation({ summary: 'List my skills' })
  @ApiOkResponse({ type: [UserSkillResponseDto] })
  listSkills(@CurrentUser() user: AuthenticatedUser): Promise<UserSkillView[]> {
    return this.volunteerSkills.list(user.id);
  }

  @Post('skills')
  @ApiOperation({ summary: 'Add a skill to my profile' })
  @ApiCreatedResponse({ type: UserSkillResponseDto })
  @ApiResponse({ status: 404, description: 'Skill not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Skill already added', type: ErrorResponseDto })
  addSkill(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddUserSkillDto,
  ): Promise<UserSkillView> {
    return this.volunteerSkills.add(user.id, dto.skillId, dto.proficiency);
  }

  @Patch('skills/:skillId')
  @ApiOperation({ summary: 'Change the proficiency of one of my skills' })
  @ApiOkResponse({ type: UserSkillResponseDto })
  @ApiResponse({ status: 404, description: 'You do not have this skill', type: ErrorResponseDto })
  updateSkill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @Body() dto: UpdateUserSkillDto,
  ): Promise<UserSkillView> {
    return this.volunteerSkills.updateProficiency(user.id, skillId, dto.proficiency);
  }

  @Delete('skills/:skillId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a skill from my profile' })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiResponse({ status: 404, description: 'You do not have this skill', type: ErrorResponseDto })
  removeSkill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ): Promise<void> {
    return this.volunteerSkills.remove(user.id, skillId);
  }
}
