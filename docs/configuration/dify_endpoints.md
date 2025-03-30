# 配置多个Dify应用作为独立端点

LibreChat支持将多个Dify应用配置为独立的自定义端点。这样，您可以方便地在LibreChat界面中切换不同的Dify应用。

## 配置单个Dify端点

在`librechat.yaml`配置文件中，您可以按照以下方式配置基本的Dify端点：

```yaml
endpoints:
  dify:
    apiKey: '${DIFY_API_KEY}'
    baseURL: 'http://your-dify-instance.com/v1'
    userProvide: true  # 允许用户提供自己的API密钥
    userProvideURL: true  # 允许用户提供自己的URL
    models:  # 可选，指定可用模型列表
      - 'default-model'
    iconURL: 'https://avatars.githubusercontent.com/u/129193123'  # Dify图标URL
```

## 配置多个Dify应用作为自定义端点

要配置多个Dify应用，您可以利用LibreChat的自定义端点功能。在`librechat.yaml`中添加以下配置：

```yaml
endpoints:
  # 基本Dify端点（可选）
  dify:
    apiKey: '${DIFY_API_KEY}'
    baseURL: 'http://your-dify-instance.com/v1'
    userProvide: true
    userProvideURL: true
    iconURL: 'https://avatars.githubusercontent.com/u/129193123'

  # 自定义端点配置
  custom:
    # Dify应用1
    - name: 'DifyApp1'
      apiKey: '${DIFY_APP1_KEY}'
      baseURL: 'http://your-dify-instance.com/v1'
      models:
        default: ['default-model']
        fetch: false
      titleConvo: true
      modelDisplayLabel: 'Dify应用1'
      iconURL: 'https://path-to-your-custom-icon1.png'

    # Dify应用2
    - name: 'DifyApp2'
      apiKey: '${DIFY_APP2_KEY}'
      baseURL: 'http://your-dify-instance.com/v1'
      models:
        default: ['default-model']
        fetch: false
      titleConvo: true
      modelDisplayLabel: 'Dify应用2'
      iconURL: 'https://path-to-your-custom-icon2.png'

    # 更多Dify应用...
```

## 参数说明

每个Dify应用端点支持以下参数：

- `name`: 端点的唯一名称（必需）
- `apiKey`: Dify应用的API密钥（必需）
- `baseURL`: Dify API的基础URL（必需）
- `models`: 模型配置（必需）
  - `default`: 默认可用模型列表，通常为`['default-model']`
  - `fetch`: 是否从服务器获取模型列表，通常设为`false`
- `titleConvo`: 是否自动生成对话标题
- `modelDisplayLabel`: 在界面中显示的模型标签
- `iconURL`: 应用图标的URL
- `userProvide`: 是否允许用户提供自己的API密钥（仅适用于基本dify端点）
- `userProvideURL`: 是否允许用户提供自己的URL（仅适用于基本dify端点）

## 环境变量

推荐使用环境变量来存储API密钥：

```env
DIFY_API_KEY=your_default_dify_api_key
DIFY_APP1_KEY=your_dify_app1_api_key
DIFY_APP2_KEY=your_dify_app2_api_key
```

然后在配置中使用`${ENV_VAR_NAME}`格式引用这些环境变量。

## 端点显示

配置完成后，这些Dify应用将在LibreChat界面的端点选择菜单中显示为独立的选项，您可以轻松切换不同的Dify应用进行对话。 