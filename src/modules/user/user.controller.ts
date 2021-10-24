import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get, Inject,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import {UserService} from './user.service';
import {User} from './user.entity';
import {ResetPasswordDTO, UserDTO, UserPasswordChangeDTO} from './UserDTO';
import {JwtAuthGuard} from '../../guards/jwt-auth.guard';
import {JwtAuthGuard2} from '../../guards/jwt-auth.guard2';
import {Role} from '../../guards/role.decorator';
import {ADMIN_ROLE} from '../auth/roles';
import {RoleGuard} from '../../guards/role-guard.service';
import {LocalAuthGuard} from '../../guards/local-auth.guard';
import {plainToClass} from 'class-transformer';
import {UserFilter} from './user-filter';
import {TCMailerService} from '../mailer/mailer-service';
import {getLogger} from 'log4js';

const logger = getLogger('UserController');

@UseInterceptors(ClassSerializerInterceptor)
@Controller('user')
export class UserController {
  constructor(
    private readonly service: UserService,
    private readonly mailerService: TCMailerService,
  ) {
  }

  @Get('test')
  async test(): Promise<any> {
    logger.info('test');
    this.mailerService.example();
    return true;
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Get()
  async findFiltered(@Query() params): Promise<any[]> {
    const filter: UserFilter = plainToClass(UserFilter, params);
    return await this.service.findFiltered(filter);
  }

  @Get('findUsers/:userType')
  async findUsers(@Param('userType')  userType: string): Promise<UserDTO[]> {
    return await this.service.findUsers(userType);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Get('isUsernameInUse/:test')
  async doesUsernameExist(@Param('test')  test: string): Promise<boolean> {
    return await this.service.doesUsernameExist(test);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Get('isNameInUse/:test')
  async doesNameExist(@Param('test')  test: string): Promise<boolean> {
    return await this.service.doesNameExist(test);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Get('isEmailInUse/:test')
  async doesEmailExist(@Param('test')  test: string): Promise<boolean> {
    return await this.service.doesEmailExist(test);
  }

  // This one is strange the way it is now. Anyone anywhere could reset anyone else's password by knowing
  // another user's username.  Seems wrong.  But we cannot guard it with a normal JwtAuthGuard because
  // then the user would have to log in in order to be able to reset their forgotten password.
  @Put('resetPassword')
  async resetPassword(@Body() dto: ResetPasswordDTO): Promise<User> {
    return this.service.resetPassword(dto);
  }

  // Users can be created through import or from the GUI
  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Post('import')
  async import(@Body() dto: UserDTO): Promise<User> {
    return this.service.import(dto);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Post()
  async create(@Body() dto: UserDTO): Promise<User> {
    return this.service.create(dto);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Put()
  async update(@Body() dto: UserDTO): Promise<User> {
    return this.service.update(dto);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Put('activate')
  async activate(@Body() dto: UserDTO): Promise<User> {
    return this.service.activate(dto);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Put('deactivate')
  async deactivate(@Body() dto: UserDTO): Promise<User> {
    return this.service.deactivate(dto);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Put('forceLogout')
  async forceLogout(@Body() dto: UserDTO): Promise<User> {
    return this.service.forceLogout(dto);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Delete(':id')
  async delete(@Param('id')  id: string): Promise<User> {
    return this.service.delete(id);
  }

  @Role(ADMIN_ROLE)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Get(':id')
  async getById(@Param('id')  id: string): Promise<User> {
    return await this.service.findOne(id);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Request() req): Promise<{ access_token: string }> {
    // Don't forget, Ted, that the LocalAuthGuard
    // handles the Request and sticks the whole validated user in it.
    return {access_token: await this.service.login(req.user)};
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req): Promise<boolean> {
    // Remember, the JwtAuthGuard looks up the user based on info in the
    // token and pushes the user object into the request.
    return await this.service.logout(req.user);
  }

  // Note the special AuthGuard, it does not check for the "requiresPasswordChange" state.
  // Otherwise the user would be permanently blocked if they lost their initial start-up message.
  @UseGuards(JwtAuthGuard2)
  @Put('changePassword')
  async changePassword(@Request() req, @Body() dto: UserPasswordChangeDTO): Promise<{ access_token: string }> {
    return {access_token: await this.service.changePassword(req.user, dto)};
  }
}
