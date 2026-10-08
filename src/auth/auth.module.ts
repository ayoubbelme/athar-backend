import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})], // secrets are passed per call
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordService, JwtStrategy],
})
export class AuthModule {}
