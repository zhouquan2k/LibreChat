const { EModelEndpoint } = require('librechat-data-provider');
const { isUserProvided } = require('~/server/utils');
const { config } = require('./EndpointService');

const { openAIApiKey, azureOpenAIApiKey, useAzurePlugins, userProvidedOpenAI, googleKey, difyApiKey, difyBaseUrl } = config;

/**
 * Load async endpoints and return a configuration object
 * @param {Express.Request} req - The request object
 */
async function loadAsyncEndpoints(req) {
  let i = 0;
  let serviceKey, googleUserProvides;
  try {
    serviceKey = require('~/data/auth.json');
  } catch (e) {
    if (i === 0) {
      i++;
    }
  }

  if (isUserProvided(googleKey)) {
    googleUserProvides = true;
    if (i <= 1) {
      i++;
    }
  }

  const google = serviceKey || googleKey ? { userProvide: googleUserProvides } : false;

  // 处理dify端点配置
  const difyUserProvides = isUserProvided(difyApiKey);
  const difyUserProvidesURL = isUserProvided(difyBaseUrl);
  const dify = difyApiKey ? { 
    userProvide: difyUserProvides,
    userProvideURL: difyUserProvidesURL
  } : false;
  
  const useAzure = req.app.locals[EModelEndpoint.azureOpenAI]?.plugins;
  const gptPlugins =
    useAzure || openAIApiKey || azureOpenAIApiKey
      ? {
        availableAgents: ['classic', 'functions'],
        userProvide: useAzure ? false : userProvidedOpenAI,
        userProvideURL: useAzure
          ? false
          : config[EModelEndpoint.openAI]?.userProvideURL ||
              config[EModelEndpoint.azureOpenAI]?.userProvideURL,
        azure: useAzurePlugins || useAzure,
      }
      : false;

  return { google, gptPlugins, dify };
}

module.exports = loadAsyncEndpoints;
