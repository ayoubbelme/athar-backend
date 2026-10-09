import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';
import { UsersAdminService } from './services/users-admin.service';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersAdminService],
  exports: [UsersService],
})
export class UsersModule {}
