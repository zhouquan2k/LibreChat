const axios = require('axios');
const { EventSource } = require('eventsource');
const { 
  Constants, 
  ContentTypes,
  EModelEndpoint,
  KnownEndpoints 
} = require('librechat-data-provider');
const { spendTokens } = require('~/models/spendTokens');
const { addSpaceIfNeeded, sleep } = require('~/server/utils');
const TextStream = require('./TextStream');
const { logger, sendEvent } = require('~/config');
const Tokenizer = require('~/server/services/Tokenizer');
const BaseClient = require('./BaseClient');
const { v4 } = require('uuid');

class DifyClient extends BaseClient {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.setOptions(options);
    this.clientName = EModelEndpoint.dify;
    this.modelOptions = {};
    this.metadata = {};
  }

  setOptions(options) {
    if (this.options && !this.options.replaceOptions) {
      this.options.modelOptions = {
        ...this.options.modelOptions,
        ...options.modelOptions,
      };
      delete options.modelOptions;
      this.options = {
        ...this.options,
        ...options,
      };
    } else {
      this.options = options;
    }

    this.apiKey = options.difyApiKey || this.apiKey;
    this.baseURL = options.reverseProxyUrl || 'https://api.dify.ai/v1';
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
    this.req = options.req;
    this.res = options.res;
    this.abortController = null;
    this.conversationId = options.conversationId || null;
    this.parentMessageId = options.parentMessageId || null;
    this.responseMessageId = options.responseMessageId;
    this.streamRate = options.streamRate ?? Constants.DEFAULT_STREAM_RATE;
    this.sender = options.sender ?? 'Dify';
    this.userLabel = options.userLabel || 'User';
    this.maxContextTokens = options.maxContextTokens || 4000;
    this.maxResponseTokens = options.maxResponseTokens || 1000;
    this.maxPromptTokens = options.maxPromptTokens || this.maxContextTokens - this.maxResponseTokens;

    return this;
  }

  getEncoding() {
    return 'cl100k_base';
  }

  /**
   * Returns the token count of a given text.
   * @param {string} text - The text to get the token count for.
   * @returns {number} The token count of the given text.
   */
  getTokenCount(text) {
    const encoding = this.getEncoding();
    return Tokenizer.getTokenCount(text, encoding);
  }

  /**
   * Gets the token count for a message.
   * @param {Object} message - The message to get the token count for.
   * @returns {number} The token count.
   */
  getTokenCountForMessage(message) {
    // 基本计数为4（包括角色标识等开销）
    let tokensPerMessage = 4;
    let numTokens = tokensPerMessage;

    const processValue = (value) => {
      if (typeof value === 'string') {
        numTokens += this.getTokenCount(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (
            !item ||
            !item.type ||
            item.type === ContentTypes.THINK ||
            item.type === ContentTypes.ERROR ||
            item.type === ContentTypes.IMAGE_URL
          ) {
            continue;
          }
          const nestedValue = item[item.type];
          if (!nestedValue) {
            continue;
          }
          processValue(nestedValue);
        }
      }
    };

    for (const [key, value] of Object.entries(message)) {
      processValue(value);
    }

    return numTokens;
  }

  /**
   * Gets the token count for a response.
   * @param {Object} responseMessage - The response message to get the token count for.
   * @returns {number} The token count.
   */
  getTokenCountForResponse(responseMessage) {
    return this.getTokenCountForMessage({
      role: 'assistant',
      content: responseMessage.text,
    });
  }

  /**
   * Records token usage.
   * @param {Object} params - Parameters for token usage recording.
   * @param {number} params.promptTokens - Number of prompt tokens.
   * @param {number} params.completionTokens - Number of completion tokens.
   * @param {Object} [params.usage] - Usage information.
   * @param {string} [params.context='message'] - Context of the token usage.
   * @returns {Promise<void>}
   */
  async recordTokenUsage({ promptTokens, completionTokens, usage, context = 'message' }) {
    await spendTokens(
      {
        context,
        model: this.modelOptions?.model || 'dify-default',
        conversationId: this.conversationId,
        user: this.user ?? this.options.req?.user?.id,
        endpointTokenConfig: this.options.endpointTokenConfig,
      },
      { promptTokens, completionTokens },
    );
  }

  /**
   * Get options for building messages.
   * @returns {Object} The options for building messages.
   */
  getBuildMessagesOptions(opts) {
    return {
      promptPrefix: opts.promptPrefix,
      abortController: opts.abortController,
    };
  }

  /**
   * Get the save options for the conversation.
   * @returns {Object} The save options.
   */
  getSaveOptions() {
    return {
      chatGptLabel: this.options.chatGptLabel,
      promptPrefix: this.options.promptPrefix,
      resendFiles: this.options.resendFiles,
      modelLabel: this.options.modelLabel,
      iconURL: this.options.iconURL,
      ...this.modelOptions,
    };
  }

  /**
   * Build messages for the conversation.
   * @param {Array} messages - The messages for the conversation.
   * @param {string} parentMessageId - The parent message ID.
   * @param {Object} opts - Options for building messages.
   * @returns {Promise<Object>} The built messages.
   */
  async buildMessages(messages, parentMessageId, opts) {
    let orderedMessages = this.constructor.getMessagesForConversation({
      messages,
      parentMessageId,
    });

    const formattedMessages = orderedMessages.map((message) => {
      let role = message.isCreatedByUser ? 'user' : 'assistant';
      let content = message.text;

      if (!orderedMessages[0].tokenCount) {
        message.tokenCount = this.getTokenCountForMessage({ role, content });
      }

      return { role, content };
    });

    // 将格式化的消息转换为Dify所需的格式
    const lastUserMessage = formattedMessages[formattedMessages.length - 1];
    const prompt = lastUserMessage?.content || '';

    // 返回结果
    return {
      prompt,
      messages: formattedMessages,
      promptTokens: this.getTokenCount(prompt),
    };
  }

  /**
   * Build the payload for the API request.
   * @param {string} message - The message to send.
   * @param {string} responseMode - The response mode ('blocking' or 'streaming').
   * @param {Object} opts - Additional options.
   * @returns {Object} The built payload.
   */
  _buildPayload(message, responseMode, opts = {}) {
    const payload = {
      query: message,
      response_mode: responseMode,
      user: opts.user || this.user || this.req?.user?.id || 'librechat_user',
      inputs: opts.inputs || [],
    };
    
    // 处理文件
    if (opts.files && opts.files.length > 0) {
      payload.files = opts.files.map(file => ({
        type: file.type || 'image',
        transfer_method: 'remote_url',
        url: file.url || file.filepath
      }));
    }
    
    return payload;
  }

  /**
   * Send a completion to the API.
   * @param {string} message - The message to send.
   * @param {Object} opts - Additional options.
   * @returns {Promise<string>} The completion.
   */
  async sendCompletion(message, opts = {}) {
    try {
      if (opts.onProgress) {
        return await this.sendStreamCompletion(message, opts);
      }

      const url = `${this.baseURL}/chat-messages`;
      const payload = this._buildPayload(message, 'blocking', opts);
      
      const response = await axios.post(url, payload, { 
        headers: this.headers,
        signal: this.abortController?.signal 
      });
      
      // 保存会话ID
      this.conversationId = response.data.conversation_id;
      this.metadata = response.data.metadata || {};
      
      return response.data.answer || '';
    } catch (error) {
      logger.error('[DifyClient] sendCompletion error:', error);
      throw new Error(`Dify API错误: ${error.message}`);
    }
  }

  /**
   * Send a stream completion to the API.
   * @param {string} message - The message to send.
   * @param {Object} opts - Additional options.
   * @returns {Promise<string>} The completion.
   */
  async sendStreamCompletion(message, opts = {}) {
    if (!this.res) {
      throw new Error('缺少响应对象');
    }

    this.abortController = opts.abortController || new AbortController();
    
    // 创建取消事件监听
    if (this.req) {
      this.req.once('close', () => {
        if (this.abortController && !this.abortController.signal.aborted) {
          this.abortController.abort();
        }
      });
    }

    let fullText = '';
    let buffer = '';
    const onProgress = opts.onProgress;
    
    // 生成两个唯一的step ID，分别用于reasoning和message事件
    const reasoningStepId = `step_reasoning_${Math.random().toString(36).substring(2, 15)}`;
    const messageStepId = `step_message_${Math.random().toString(36).substring(2, 15)}`;
    
    // 生成运行ID
    const runId = `run_${Math.random().toString(36).substring(2, 15)}`;
    
    // 生成消息ID
    const messageId = `msg_${Math.random().toString(36).substring(2, 15)}`;
    
    // 用于跟踪思考内容的状态
    let collectingThinking = false;
    let hasSentThinkStart = false;
    
    // 跟踪当前的runstep类型
    let currentRunStepType = null;
    
    // 切换runstep类型的辅助函数
    const switchRunStepType = (newType) => {
      if (currentRunStepType !== newType) {
        const stepId = newType === 'reasoning' ? reasoningStepId : messageStepId;
        this.sendRunStepEvent(stepId, runId, messageId, newType);
        currentRunStepType = newType;
      }
    };

    try {
      const url = `${this.baseURL}/chat-messages`;
      const payload = this._buildPayload(message, 'streaming', opts);
      
      logger.debug('[DifyClient] Sending streaming request with payload:', payload);
      
      // 发送请求获取SSE流
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: this.abortController.signal
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Dify API错误 (${response.status}): ${errorText}`);
      }

      this.sendRunStepEvent('step_id',runId, 'message_id', 'creating');
      
      // 处理SSE流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      
      // 读取和处理流数据
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 解码二进制数据为文本
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // 解析SSE消息
        while (true) {
          const messageEndIndex = buffer.indexOf('\n\n');
          if (messageEndIndex === -1) break; // 没有完整消息，等待更多数据
          
          // 提取完整消息
          const message = buffer.substring(0, messageEndIndex);
          // 更新缓冲区，移除已处理的消息
          buffer = buffer.substring(messageEndIndex + 2);
          
          // 只处理以 "data:" 开头的消息
          if (!message.startsWith('data:')) continue;
          
          try {
            // 提取data部分
            const dataStr = message.substring(5).trim();
            const data = JSON.parse(dataStr);
            logger.debug('[DifyClient] Received SSE event:', data.event, data.data?.title);
            
            // 处理工作流事件
            if (data.event === 'node_started') {
              const nodeId = data.data.node_id;
              const title = data.data.title;
              // 使用setAgentUpdate发送状态更新
              this.setAgentUpdate(runId, title, { 
                type: 'start',
                nodeId: nodeId
              });
            } else if (data.event === 'node_finished') {
              /*
              const nodeId = data.data.node_id;
              const title = data.data.title;
              // 使用setAgentUpdate发送状态完成
              this.setAgentUpdate(runId, title, {
                type: 'end',
                nodeId: nodeId
              });
              */
            } else if (data.event === 'workflow_finished') {
              // 发送工作流完成状态更新
              // this.setAgentUpdate(runId, '工作流处理完成', { type: 'end' });
              logger.debug('[DifyClient] 工作流完成');
            }
            
            if (data.event === 'message') {
              const content = data.answer || '';
              logger.debug(content);
              
              // 流式处理思考内容
              let processedContent = content;
              
              // 检查是否开始收集思考内容
              if (!collectingThinking && content.includes('<details')) {
                collectingThinking = true;
                if (!hasSentThinkStart) {
                  // 切换到reasoning类型
                  switchRunStepType('reasoning');
                  hasSentThinkStart = true;
                  processedContent = content.substring(0, content.indexOf('<details')) + '\n\n:::thinking\n' +content.substring(content.indexOf('<details'));
                }
                
                // 从<details开始截取思考内容
                const detailsStartIndex = content.indexOf('<details');
                // 移除<details>部分
                
                // 将details后的内容发送到思考流
                const thinkingPart = content.substring(detailsStartIndex);
                if (thinkingPart) {
                  this.sendReasoningDelta(reasoningStepId, thinkingPart);
                }
                
                // 保留完整内容，包括思考部分
                fullText +=  processedContent;

                processedContent = content.substring(0, detailsStartIndex);
                // 只将非思考部分发送到message流
                if (processedContent) {
                  // 切换到message_creation类型
                  switchRunStepType('message_creation');
                  this.sendMessageDelta(messageStepId, processedContent);
                }
              } 
              // 如果正在收集思考内容
              else if (collectingThinking) {
                // 直接发送内容作为思考内容
                this.sendReasoningDelta(reasoningStepId, content);
                
                // 将思考内容添加到最终文本
                
                
                // 检查是否结束思考内容
                if (content.includes('</details>')) {
                  collectingThinking = false;
                  // 发送思考结束标记
                  
                  // 从内容中提取</details>后的部分
                  const detailsEndIndex = content.indexOf('</details>') + 10;
                  processedContent = ':::\n\n\n' + content.substring(detailsEndIndex) ;
                  
                  // 将</details>后的部分发送到message流
                  if (processedContent) {
                    // 切换到message_creation类型
                    switchRunStepType('message_creation');
                    this.sendMessageDelta(messageStepId, content.substring(detailsEndIndex));
                  }

                  fullText += processedContent;
                } else {
                  fullText += content;
                  // 如果还在收集思考内容，不发送到message流
                  processedContent = '';
                }
              }
              else {
                // 更新最终文本，并发送进度更新
                fullText += processedContent;
                /*
                if (typeof onProgress === 'function') {
                  onProgress(processedContent);
                }
                */
                // 发送消息增量更新，使用message专用ID
                switchRunStepType('message_creation');
                this.sendMessageDelta(messageStepId, processedContent);
              }
              
              this.conversationId = data.conversation_id || this.conversationId;
              
              // 控制流速
              await sleep(this.streamRate);
            } 
            else if (data.event === 'message_end') {
              // 如果消息结束但仍在收集思考内容，确保关闭思考
              if (collectingThinking) {
                collectingThinking = false;
                if (hasSentThinkStart) {
                  this.sendReasoningDelta(reasoningStepId, '</think>');
                }
              }
              
              this.conversationId = data.conversation_id || this.conversationId;
              this.metadata = data.metadata || {};
            }
            else if (data.event === 'error') {
              logger.error('[DifyClient] Stream error:', data.message);
              if (typeof onProgress === 'function') {
                onProgress(`\n\n错误: ${data.message || '未知错误'}`);
              }
            }
          } catch (error) {
            logger.error('[DifyClient] 解析SSE数据失败:', error, '原始数据:', message);
          }
        }
      }
      
      return fullText;
    } catch (error) {
      if (error.name === 'AbortError' || this.abortController.signal.aborted) {
        logger.debug('[DifyClient] 请求被中止');
        return fullText;
      }
      
      logger.error('[DifyClient] 流式请求失败:', error);
      throw error;
    }
  }
  
  /**
   * 发送on_run_step事件
   * @param {string} stepId - 步骤ID
   * @param {string} runId - 运行ID
   * @param {string} messageId - 消息ID
   * @param {string} type - 步骤类型，可以是'reasoning'或'message_creation'
   */
  sendRunStepEvent(stepId, runId, messageId, type) {
    if (!this.res) return;
    
    const runStepEvent = {
          event: 'on_run_step',
          data: {
            id: stepId,
            runId: runId,
            type: type,
            index: 0,
            stepDetails: {
              type: type,
              [type]: {
                message_id: messageId
              }
            }
          }
    };
    
    // 使用sendEvent发送事件
    sendEvent(this.res, runStepEvent);
  }
  
  /**
   * 发送on_reasoning_delta事件
   * @param {string} stepId - 步骤ID
   * @param {string} thinkText - 思考内容文本
   */
  sendReasoningDelta(stepId, thinkText) {
    if (!this.res) return;
    
    const reasoningEvent = {
        event: 'on_reasoning_delta',
        data: {
          id: stepId,
          delta: {
            content: [
              {
                type: 'think',
                think: thinkText
              }
            ]
          }
        }
    };
    
    // 使用sendEvent发送事件
    sendEvent(this.res, reasoningEvent);
  }
  
  /**
   * 发送on_message_delta事件
   * @param {string} stepId - 步骤ID
   * @param {string} messageText - 消息内容文本
   */
  sendMessageDelta(stepId, messageText) {
    if (!this.res) return;
    
    const messageEvent = {
        event: 'on_message_delta',
        data: {
          id: stepId,
          delta: {
            content: [
              {
                type: 'text',
                text: messageText
              }
            ]
          }
        }
    };
    
    // 使用sendEvent发送事件
    sendEvent(this.res, messageEvent);
  }
  
  /**
   * 从内容中移除<details>标签
   * @param {string} content - 包含<details>标签的内容
   * @returns {string} 不含<details>标签的内容
   */
  removeDetailsTag(content) {
    return content.replace(/<details[^>]*>[\s\S]*?<\/details>/g, '');
  }

  checkVisionRequest(files) {
    if (!files || !Array.isArray(files) || files.length === 0) {
      return false;
    }
    // 检查是否有任何文件需要处理
    return files.some(file => file && file.type && file.type.startsWith('image/'));
  }

  /**
   * Abort the current request.
   */
  abort() {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  /**
   * Generate a title for the conversation.
   * @param {Object} params - Parameters for title generation.
   * @param {string} params.text - The text to generate a title from.
   * @param {string} [params.conversationId] - The conversation ID.
   * @param {string} [params.responseText=''] - The response text.
   * @returns {Promise<string>} The generated title.
   */
  async titleConvo({ text, conversationId, responseText = '' }) {
    // 简单实现，直接从输入文本中提取前几个字作为标题
    this.conversationId = conversationId;
    
    // 提取前30个字符作为标题，去除换行符并添加省略号
    let title = text.substring(0, 30).replace(/\n/g, ' ');
    if (text.length > 30) {
      title += '...';
    }
    
    return title;
  }

  getMessageMapMethod() {
    return (msg) => {
      // 不过滤think内容，直接返回原始消息
      return msg;
    };
  }

  /**
   * 设置代理状态更新
   * @param {string} runId - 运行ID
   * @param {string} status - 状态信息
   * @param {Object} options - 附加选项
   * @param {string} options.type - 状态类型，可以是 'start' 或 'end'
   * @param {string} options.nodeId - 节点ID
   */
  setAgentUpdate(runId, status, options = {}) {
    if (!this.res) return;
    
    const { type = 'progress', nodeId = '' } = options;
    
    // 根据类型添加前缀或后缀
    let statusText = status;
    if (type === 'start') {
      statusText = `执行中: ${status}`;
    } else if (type === 'end') {
      statusText = `完成: ${status}`;
    }
    
    // 创建代理更新事件
    const agentUpdateEvent = {
      event: 'on_agent_update',
      data: {
        runId: runId,
        index: 0,
        type: ContentTypes.AGENT_UPDATE,
        agent_update: {
          runId: runId,
          index: 0,
          status: statusText,
          nodeId: nodeId,
          agentId: 'dify' // 添加 agentId 字段，使用 'dify' 作为默认值
        }
      }
    };
    
    // 发送事件
    sendEvent(this.res, agentUpdateEvent);
    
    return statusText;
  }
}

module.exports = DifyClient; 