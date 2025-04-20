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
const { getCustomConfig } = require('~/server/services/Config/getCustomConfig');

const { PROXY } = process.env;
const DIFY_API_KEY = process.env.DIFY_API_KEY || '';
const DIFY_BASE_URL = process.env.DIFY_BASE_URL || 'http://192.168.157.17/v1';

/**
 * 初始化Dify客户端
 */
const initializeClient = async ({ req, res, endpointOption }) => {
  const { key: expiresAt, conversationId, parentMessageId, responseMessageId } = req.body;
  
  // 从自定义配置获取用户设置
  const customConfig = await getCustomConfig();
  const difyConfig = customConfig?.endpoints?.dify || {};
  
  const userProvideKey = typeof difyConfig.userProvide === 'boolean' ? difyConfig.userProvide : true;
  const userProvideURL = typeof difyConfig.userProvideURL === 'boolean' ? difyConfig.userProvideURL : true;
  
  const userProvidesKey = isUserProvided(DIFY_API_KEY) && userProvideKey;
  const userProvidesURL = isUserProvided(DIFY_BASE_URL) && userProvideURL;
  
  let userValues = null;
  let apiKey = difyConfig.apiKey || DIFY_API_KEY;
  let baseURL = difyConfig.baseURL || DIFY_BASE_URL;
  
  // 处理环境变量
  if (apiKey && envVarRegex.test(apiKey)) {
    apiKey = process.env[extractEnvVariable(apiKey)] || '';
  }
  
  if (baseURL && envVarRegex.test(baseURL)) {
    baseURL = process.env[extractEnvVariable(baseURL)] || '';
  }
  
  // 如果配置中有models，设置到endpointOption
  if (difyConfig.models && Array.isArray(difyConfig.models)) {
    endpointOption.modelOptions = {
      ...endpointOption.modelOptions,
      availableModels: difyConfig.models
    };
  }
  
  // 处理用户提供的密钥和URL
  if (expiresAt && (userProvidesKey || userProvidesURL)) {
    checkUserKeyExpiry(expiresAt, 'dify');
    userValues = await getUserKeyValues({ userId: req.user.id, name: 'dify' });
    
    apiKey = userProvidesKey ? userValues?.apiKey : apiKey;
    baseURL = userProvidesURL ? userValues?.baseURL : baseURL;
  }
  
  // 处理customEndpoint的情况 - 如果是从custom endpoint调用
  if (endpointOption?.endpoint && endpointOption.endpoint !== 'dify') {
    try {
      // 查找对应的custom endpoint配置
      const customEndpoints = customConfig?.endpoints?.custom || [];
      const customEndpoint = customEndpoints.find(e => normalizeEndpointName(e.name) === endpointOption.endpoint);
      
      if (customEndpoint?.clientType === 'dify') {
        logger.debug(`[Dify] 使用custom endpoint配置: ${endpointOption.endpoint}`);
        
        // 使用custom endpoint的配置
        if (customEndpoint.apiKey) {
          if (envVarRegex.test(customEndpoint.apiKey)) {
            apiKey = process.env[extractEnvVariable(customEndpoint.apiKey)] || '';
          } else {
            apiKey = customEndpoint.apiKey;
          }
        }
        
        if (customEndpoint.baseURL) {
          if (envVarRegex.test(customEndpoint.baseURL)) {
            baseURL = process.env[extractEnvVariable(customEndpoint.baseURL)] || '';
          } else {
            baseURL = customEndpoint.baseURL;
          }
        }
      }
    } catch (error) {
      logger.error(`[Dify] 处理custom endpoint时出错: ${error.message}`);
    }
  }

  // 对于clientType为dify的custom端点，我们允许没有apiKey和baseURL
  const isCustomDify = endpointOption?.endpoint && 
                      endpointOption.endpoint !== 'dify' && 
                      customConfig?.endpoints?.custom?.find(e => 
                        normalizeEndpointName(e.name) === endpointOption.endpoint && 
                        e.clientType === 'dify');

  if (!isCustomDify) {
    // 只对标准dify端点进行验证
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
  }
  
  logger.debug('[Dify] 初始化客户端', { 
    userProvidesKey, 
    userProvidesURL, 
    baseURL, 
    endpoint: endpointOption?.endpoint,
    isCustomDify
  });
  
  // 客户端选项
  const clientOptions = {
    reverseProxyUrl: baseURL,
    proxy: PROXY ?? null,
    req,
    res,
    conversationId,
    parentMessageId, 
    responseMessageId,
    sender: endpointOption.sender,
    ...endpointOption,
  };
  
  // 使用用户的username作为doctor_code
  if (req.user && req.user.username) {
    clientOptions.username = req.user.username;
    logger.debug('[Dify] 使用用户名作为doctor_code:', req.user.username);
  } else {
    logger.warn('[Dify] 未找到用户名，可能会导致Dify API调用失败');
  }
  
  // 创建Dify客户端
  const client = new DifyClient(apiKey, clientOptions);
  
  // 记录username状态
  logger.debug('[Dify] username status:', { 
    available: !!clientOptions.username,
    username: clientOptions.username || 'not available'
  });
  
  return {
    client,
    difyApiKey: apiKey
  };
};

// 添加缺失的函数
const normalizeEndpointName = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

module.exports = initializeClient; 