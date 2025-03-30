const { getEndpointsConfig } = require('~/server/services/Config');

async function endpointController(req, res) {
  try {
    const endpointsConfig = await getEndpointsConfig(req);
    
    // 确保disabled属性正确传递到前端
    for (const key in endpointsConfig) {
      if (endpointsConfig[key]?.disabled === true) {
        // 保持disabled状态但保留其他配置
        endpointsConfig[key] = {
          ...endpointsConfig[key],
          disabled: true
        };
      }
    }
    
    res.send(JSON.stringify(endpointsConfig));
  } catch (error) {
    console.error('[EndpointController] Error:', error);
    res.status(500).json({ message: 'Failed to get endpoints' });
  }
}

module.exports = endpointController;
