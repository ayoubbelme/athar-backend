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
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginatedResult } from '../../common/dto/paginated-response.dto';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  CreateSkillDto,
  ListSkillsQueryDto,
  SkillResponseDto,
  UpdateSkillDto,
} from '../dto/skill.dto';
import { SkillsService } from '../services/skills.service';

@ApiTags(API_TAGS.SKILLS)
@ApiBearerAuth(BEARER_AUTH_NAME)
@ApiResponse({ status: 401, description: 'Unauthorized', type: ErrorResponseDto })
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @ApiOperation({ summary: 'List / search skills (any authenticated user)' })
  @ApiPaginatedResponse(SkillResponseDto)
  list(@Query() query: ListSkillsQueryDto): Promise<PaginatedResult<SkillResponseDto>> {
    return this.skills.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a skill' })
  @ApiOkResponse({ type: SkillResponseDto })
  @ApiResponse({ status: 404, description: 'Skill not found', type: ErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SkillResponseDto> {
    return this.skills.findOne(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a skill (ADMIN)' })
  @ApiCreatedResponse({ type: SkillResponseDto })
  @ApiResponse({ status: 403, description: 'Admin only', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Name already exists', type: ErrorResponseDto })
  create(@Body() dto: CreateSkillDto): Promise<SkillResponseDto> {
    return this.skills.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a skill (ADMIN)' })
  @ApiOkResponse({ type: SkillResponseDto })
  @ApiResponse({ status: 403, description: 'Admin only', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Skill not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Name already exists', type: ErrorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
  ): Promise<SkillResponseDto> {
    return this.skills.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a skill (ADMIN)',
    description: 'Rejected with 409 while volunteers or projects still reference the skill.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiResponse({ status: 403, description: 'Admin only', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Skill not found', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Skill is in use', type: ErrorResponseDto })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.skills.remove(id);
  }
}
