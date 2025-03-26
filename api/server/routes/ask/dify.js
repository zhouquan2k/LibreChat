const express = require('express');
const { EModelEndpoint } = require('librechat-data-provider');
const AskController = require('~/server/controllers/AskController');
const { initializeClient } = require('~/server/services/Endpoints/dify');
const { handleAbort, setHeaders, validateEndpoint, buildEndpointOption } = require('~/server/middleware');
const { logger } = require('~/config');

const router = express.Router();

router.post('/abort', handleAbort());

router.post(
  '/',
  setHeaders,
  validateEndpoint,
  buildEndpointOption,
  async (req, res, next) => {
    try {
      // 添加标题的方法
      const addTitle = async (client, { conversationId, responseMessageId, userMessage }) => {
        try {
          // 避免不必要的标题生成
          if (!conversationId) {
            return;
          }
        
          // 使用客户端自身的titleConvo方法生成标题
          const title = await client.titleConvo({
            text: userMessage.text,
            conversationId,
          });

          // 如果标题生成成功，可以在这里保存到数据库
          if (title) {
            logger.debug('[Dify] 生成标题成功', { title, conversationId });
          }
        } catch (error) {
          logger.error('[Dify] 生成标题失败', error);
        }
      };

      await AskController(req, res, next, initializeClient, addTitle);
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router; 