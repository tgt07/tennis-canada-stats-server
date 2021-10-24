import {ExtractJwt, Strategy} from 'passport-jwt';
import {PassportStrategy} from '@nestjs/passport';
import {Injectable, UnauthorizedException} from '@nestjs/common';
import {ConfigurationService} from '../modules/configuration/configuration.service';
import {AuthService} from '../modules/auth/auth.service';
import {UserService} from '../modules/user/user.service';

// I'm so sorry. I lack understanding so I am employing a hammer.
// The problem: the normal jwt strategy validates the jwt and checks
// if the user is supposed to change their password.
// EXCEPT for the password change request itself.
// The difficulty is that I did not see how to make that exception
// within the jwt strategy. So I made this whole new strategy
// that does not check the "passwordChangeRequired" state and
// use it to make a Guard for exactly one route - the change password route.
@Injectable()
export class JwtStrategy2 extends PassportStrategy(Strategy, 'jwt2') {
  constructor(
    private configService: ConfigurationService,
    private authService: AuthService,
    private userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwtSecret,
    });
  }

  async validate(payload: any) {
    // At this point, the token itself and the expiry have already been checked by Passport.

    // However, the user may have logged out or been deactivated.
    const user = await this.userService.findActiveUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Token does not identify an active user.');
    }

    // Here is the only difference from the normal jwt strategy.
    // if (user.passwordChangeRequired) {
    //   throw new UnauthorizedException('Password change required.');
    // }

    if (!user.isLoggedIn) {
      throw new UnauthorizedException('Token does not identify a logged in user.');
    }

    // passport will stick the user in the request object for us.
    return user;
  }
}
