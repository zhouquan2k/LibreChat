const { z } = require('zod');
const { logger } = require('~/config');

/**
 * 验证修改密码请求的中间件
 * 确保请求体包含当前密码、新密码和确认密码，且符合密码规则
 */
function validateChangePassword(req, res, next) {
  try {
    const schema = z.object({
      currentPassword: z
        .string()
        .min(1, { message: '当前密码不能为空' }),
      newPassword: z
        .string()
        .min(8, { message: '新密码至少需要8个字符' })
        .max(128, { message: '新密码最多128个字符' })
        .refine((value) => value.trim().length > 0, {
          message: '新密码不能只包含空格',
        }),
      confirmPassword: z
        .string()
        .min(1, { message: '确认密码不能为空' }),
    }).refine((data) => data.newPassword === data.confirmPassword, {
      message: '新密码与确认密码不匹配',
      path: ['confirmPassword'],
    });

    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      const errorMessage = result.error.errors.map(err => `${err.path}: ${err.message}`).join(', ');
      logger.warn(`[validateChangePassword] Invalid request: ${errorMessage} [IP: ${req.ip}]`);
      return res.status(400).json({ message: errorMessage });
    }
    
    next();
  } catch (error) {
    logger.error('[validateChangePassword]', error);
    return res.status(500).json({ message: '验证请求时出错' });
  }
}

module.exports = validateChangePassword; 