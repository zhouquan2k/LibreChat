const { errorsToString } = require('librechat-data-provider');
const { Strategy: PassportLocalStrategy } = require('passport-local');
const { findUser, comparePassword, updateUser } = require('~/models');
const { isEnabled, checkEmailConfig } = require('~/server/utils');
const { loginSchema } = require('./validators');
const logger = require('~/utils/logger');

// Unix timestamp for 2024-06-07 15:20:18 Eastern Time
const verificationEnabledTimestamp = 1717788018;

async function validateLoginRequest(req) {
  const { error } = loginSchema.safeParse(req.body);
  return error ? errorsToString(error.errors) : null;
}

async function passportLogin(req, identifier, password, done) {
  try {
    const validationError = await validateLoginRequest(req);
    if (validationError) {
      logError('Passport Local Strategy - Validation Error', { reqBody: req.body });
      logger.error(`[Login] [Login failed] [Identifier: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: validationError });
    }

    // 确定输入是邮箱还是用户名
    const emailRegex = /\S+@\S+\.\S+/;
    const isEmail = emailRegex.test(identifier.trim());
    
    let user;
    if (isEmail) {
      // 如果是邮箱格式，通过邮箱查找
      user = await findUser({ email: identifier.trim() });
    } else {
      // 如果是用户名格式，通过用户名查找
      user = await findUser({ username: identifier.trim() });
    }

    if (!user) {
      logError('Passport Local Strategy - User Not Found', { identifier, isEmail });
      logger.error(`[Login] [Login failed] [Identifier: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: isEmail ? 'Email does not exist.' : 'Username does not exist.' });
    }

    const isMatch = await comparePassword(user, password);
    if (!isMatch) {
      logError('Passport Local Strategy - Password does not match', { isMatch });
      logger.error(`[Login] [Login failed] [Identifier: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, false, { message: 'Incorrect password.' });
    }

    const emailEnabled = checkEmailConfig();
    const userCreatedAtTimestamp = Math.floor(new Date(user.createdAt).getTime() / 1000);

    if (
      !emailEnabled &&
      !user.emailVerified &&
      userCreatedAtTimestamp < verificationEnabledTimestamp
    ) {
      await updateUser(user._id, { emailVerified: true });
      user.emailVerified = true;
    }

    const unverifiedAllowed = isEnabled(process.env.ALLOW_UNVERIFIED_EMAIL_LOGIN);
    if (user.expiresAt && unverifiedAllowed) {
      await updateUser(user._id, {});
    }

    if (!user.emailVerified && !unverifiedAllowed) {
      logError('Passport Local Strategy - Email not verified', { identifier });
      logger.error(`[Login] [Login failed] [Identifier: ${identifier}] [Request-IP: ${req.ip}]`);
      return done(null, user, { message: 'Email not verified.' });
    }

    logger.info(`[Login] [Login successful] [Identifier: ${identifier}] [Request-IP: ${req.ip}]`);
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}

function logError(title, parameters) {
  const entries = Object.entries(parameters).map(([name, value]) => ({ name, value }));
  logger.error(title, { parameters: entries });
}

module.exports = () =>
  new PassportLocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      session: false,
      passReqToCallback: true,
    },
    passportLogin,
  );
