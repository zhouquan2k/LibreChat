const {
  CacheKeys,
  ErrorTypes,
  envVarRegex,
  extractEnvVariable,
} = require('librechat-data-provider');
const { getUserKeyValues, checkUserKeyExpiry } = require('~/server/services/UserService');
const { isUserProvided } = require('~/server/utils');
const getLogStores = require('~/cache/getLogStores');
const DifyClient = require('~/app/clients/DifyClient');
const { logger } = require('~/config');

const { PROXY } = process.env;
const DIFY_API_KEY = process.env.DIFY_API_KEY || '';
const DIFY_BASE_URL = process.env.DIFY_BASE_URL || 'http://192.168.157.17/v1';

/**
 * 初始化Dify客户端
 */
const initializeClient = async ({ req, res, endpointOption }) => {
  const { key: expiresAt, conversationId, parentMessageId, responseMessageId } = req.body;
  
  const userProvidesKey = isUserProvided(DIFY_API_KEY);
  const userProvidesURL = isUserProvided(DIFY_BASE_URL);
  
  let userValues = null;
  let apiKey = DIFY_API_KEY;
  let baseURL = DIFY_BASE_URL;
  
  if (expiresAt && (userProvidesKey || userProvidesURL)) {
    checkUserKeyExpiry(expiresAt, 'dify');
    userValues = await getUserKeyValues({ userId: req.user.id, name: 'dify' });
    
    apiKey = userProvidesKey ? userValues?.apiKey : DIFY_API_KEY;
    baseURL = userProvidesURL ? userValues?.baseURL : DIFY_BASE_URL;
  }

  if (userProvidesKey && !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (userProvidesURL && !baseURL) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_BASE_URL,
      }),
    );
  }

  if (!apiKey) {
    throw new Error('Dify API密钥未提供');
  }

  if (!baseURL) {
    throw new Error('Dify Base URL未提供');
  }
  
  logger.debug('[Dify] 初始化客户端', { userProvidesKey, userProvidesURL, baseURL });
  
  // 客户端选项
  const clientOptions = {
    reverseProxyUrl: baseURL,
    proxy: PROXY ?? null,
    req,
    res,
    conversationId,
    parentMessageId, 
    responseMessageId,
    ...endpointOption,
  };
  
  // 创建Dify客户端
  const client = new DifyClient(apiKey, clientOptions);
  
  return {
    client,
    difyApiKey: apiKey
  };
};

module.exports = initializeClient; 