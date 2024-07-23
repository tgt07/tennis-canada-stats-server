import {ClassSerializerInterceptor, Controller, Get, Post, Request, UseGuards, UseInterceptors} from '@nestjs/common';
import { AuthService } from './auth.service';
import {LocalAuthGuard} from '../../guards/local-auth.guard';
import {JwtAuthGuard} from '../../guards/jwt-auth.guard';

@UseInterceptors(ClassSerializerInterceptor)
@Controller()
export class AuthController {
  constructor(
    private authService: AuthService,
  ) {}

  // This is the only endpoint that uses the LocalAuthGuard (i.e. password)
  @UseGuards(LocalAuthGuard)
  @Post('auth/login')
  async login(@Request() req) {
    // Don't forget, Ted, that the LocalAuthGuard
    // handles the Request and sticks the whole validated user in it.
    return { access_token: this.authService.login(req.user)};
  }

  @UseGuards(JwtAuthGuard)
  @Post('auth/logout')
  async logout(@Request() req) {
    return this.authService.logout(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    // Don't forget, Ted, that the auth guard
    // handles the Request and sticks the whole validated user in it.
    return req.user;
  }
}
