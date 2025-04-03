const { removeNullishValues } = require('librechat-data-provider');
const generateArtifactsPrompt = require('~/app/clients/prompts/artifacts');
const { getCustomConfig } = require('~/server/services/Config/getCustomConfig');
const { config } = require('~/server/services/Config/EndpointService');

const buildOptions = async (endpoint, parsedBody, endpointType) => {
  const {
    modelLabel,
    chatGptLabel,
    promptPrefix,
    maxContextTokens,
    resendFiles = true,
    imageDetail,
    iconURL,
    greeting,
    spec,
    artifacts,
    ...modelOptions
  } = parsedBody;

  let defaultPromptPrefix;
  if (!promptPrefix) {
    const customConfig = await getCustomConfig();
    const endpointConfig = customConfig?.endpoints?.custom?.find((e) => e.name === endpoint);
    defaultPromptPrefix = endpointConfig?.promptPrefix;
  }

  const endpointOption = removeNullishValues({
    endpoint,
    endpointType,
    modelLabel,
    chatGptLabel,
    promptPrefix: promptPrefix || defaultPromptPrefix,
    resendFiles,
    imageDetail,
    iconURL,
    greeting,
    spec,
    maxContextTokens,
    modelOptions,
  });



  if (typeof artifacts === 'string') {
    endpointOption.artifactsPrompt = generateArtifactsPrompt({ endpoint, artifacts });
  }

  return endpointOption;
};

module.exports = buildOptions;
