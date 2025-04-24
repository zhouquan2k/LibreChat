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
const finalAnswerMarker = 'Final Answer:';
    

class DifyClient extends BaseClient {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.setOptions(options);
    this.clientName = EModelEndpoint.dify;
    this.clientType = EModelEndpoint.dify;
    this.modelOptions = {};
    this.metadata = {};
    this.user = options.user || null;
    this.req = options.req || null;
    this.toolCalls = new Map(); // 跟踪所有工具调用
    this.serverSideConversationId = true;
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
    this.req = options.req || this.req;
    this.res = options.res;
    this.user = options.user || this.user;
    this.abortController = null;
    this.conversationId = options.conversationId || null;
    this.parentMessageId = options.parentMessageId || null;
    this.responseMessageId = options.responseMessageId;
    this.streamRate = options.streamRate ?? Constants.DEFAULT_STREAM_RATE;
    if (options.sender) {
      this.sender = options.sender;
    }
    this.userLabel = options.userLabel || 'User';
    this.maxContextTokens = options.maxContextTokens || 4000;
    this.maxResponseTokens = options.maxResponseTokens || 1000;
    this.maxPromptTokens = options.maxPromptTokens || this.maxContextTokens - this.maxResponseTokens;
    
    // 保存doctor_code选项，但这里只作为备选方案
    this.doctor_code = options.doctor_code || null;

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
      inputs: opts.inputs || {},
    };
    
    // 添加conversationId（如果存在）
    if (opts.conversationId) {
      payload.conversation_id = opts.conversationId;
    }
    
    // 优先使用：
    // 1. 从选项中传入的username
    // 2. 从requset对象中获取用户名
    const username = this.options?.username || this.req?.user?.username;
    
    if (username) {
      // 将用户名作为doctor_code参数传给Dify
      payload.inputs['doctor_code'] = username;
      logger.debug('[DifyClient] 使用用户名作为doctor_code:', username);
    } else {
      logger.warn('[DifyClient] 未找到用户名。如果Dify API要求doctor_code参数，调用可能会失败。');
    }
    
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
    
    // 生成运行ID
    const runId = `run_${v4()}`;
    
    // 生成消息ID
    const messageId = `msg_${v4()}`;
    
    // 跟踪思考步骤
    const reasoningSteps = new Map();
    
    // 当前消息步骤ID
    const messageStepId = `step_message_${v4()}`;
    
    // 跟踪当前的runstep类型
    let currentRunStepType = null;
    // 跟踪当前正在处理的思考步骤ID
    let currentReasoningStepId = null;
    
    // 切换runstep类型的辅助函数，只在真正需要切换时发送事件
    const switchRunStepType = (newType, stepId) => {
      //if (currentRunStepType !== newType) {
        currentRunStepType = newType;
        // 只有在类型变化时才发送runStep事件
        if (newType === 'reasoning') {
          currentReasoningStepId = stepId;
          this.sendRunStepEvent(stepId, runId, messageId, 'reasoning');
        } else if (newType === 'message_creation') {
          this.sendRunStepEvent(messageStepId, runId, messageId, 'message_creation');
        } else if (newType === 'creating') {
          this.sendRunStepEvent('step_id', runId, messageId, 'creating');
        }
      //}
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

      // 发送初始状态事件
      switchRunStepType('creating');
      
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
            logger.debug('[DifyClient] Received SSE event: ' + data.event + ': ' + data.answer);
            
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
              // 处理节点完成事件
            } else if (data.event === 'workflow_finished') {
              logger.debug('[DifyClient] 工作流完成');
            }
            
            // 处理思考事件
            if (data.event === 'agent_thought') {
              const thoughtId = data.id;
              const position = data.position || 0;
              const thought = data.thought || '';
              const tool = data.tool || '';
              const toolInput = data.tool_input || '';
              const observation = data.observation || '';
              
              // 为每个新的思考步骤创建一个唯一ID
              if (!reasoningSteps.has(position)) {
                reasoningSteps.set(position, `step_reasoning_${v4()}`);
                const reasoningStepId = reasoningSteps.get(position);
                
                // 切换到reasoning类型并发送步骤事件
                switchRunStepType('reasoning', reasoningStepId);
              } else if (currentReasoningStepId !== reasoningSteps.get(position)) {
                // 如果已存在但不是当前处理的步骤，切换步骤
                switchRunStepType('reasoning', reasoningSteps.get(position));
              }
              
              const reasoningStepId = reasoningSteps.get(position);
              
              // 如果有工具调用信息，发送工具调用
              if (tool) {
                // 重新获取确保有效
                const currentStepId = reasoningSteps.get(position) || currentReasoningStepId || messageStepId;
                
                // 首先发送工具调用开始（进度0.3表示开始）
                const toolCallId = this.sendToolCallDelta(currentStepId, tool, toolInput, null, 0.3);
                
                // 如果有结果，再发送带结果的更新（进度1.0表示完成）
                if (observation) {
                  this.sendToolCallDelta(currentStepId, tool, toolInput, observation, 1.0);
                }
                
                // 可以选择保留在思考内容中也添加工具调用描述
                let reasoningContent = `\n🌟 使用工具: ${tool}\n`;
                if (toolInput) {
                  reasoningContent += `输入: ${toolInput}\n`;
                }
                if (observation) {
                  reasoningContent += `结果: ${observation}\n\n`;
                  this.sendReasoningDelta(currentStepId, reasoningContent);
                }
              }
              
              // 更新全文
              if (tool && observation) {
                fullText += `\n 🌟 使用工具: ${tool}`;
                if (toolInput) {
                  fullText += `，输入: ${toolInput}\n\n`;
                }
              }
            }
            
            // 处理消息事件
            if (['message', 'agent_message'].includes(data.event)) {
              const content = data.answer || '';
              const messageType = data.message_type || 'answer';

            
              if (messageType === 'reason') {
                // 如果是思考内容，处理为reasoning类型
                if (currentRunStepType !== 'reasoning') {
                  // 创建新的思考步骤
                  const reasoningStepId = `step_reasoning_${v4()}`;
                  const newPosition = reasoningSteps.size + 1;
                  reasoningSteps.set(newPosition, reasoningStepId);
                  
                  // 切换到reasoning类型
                  switchRunStepType('reasoning', reasoningStepId);
                }
                
                // 发送思考内容
                this.sendReasoningDelta(currentReasoningStepId, content);
              } else {
                // 答案内容，切换到message_creation类型
                if (currentRunStepType !== 'message_creation') {
                  switchRunStepType('message_creation');
                  fullText += `\n\n${finalAnswerMarker}\n\n`;
                }
                
                // 发送消息增量
                this.sendMessageDelta(messageStepId, content);
              }
              
              // 更新全文
              fullText += content;
              
              this.conversationId = data.conversation_id || this.conversationId;
              
              // 控制流速
              await sleep(this.streamRate);
            } 
            else if (data.event === 'message_end') {
              this.conversationId = data.conversation_id || this.conversationId;
              this.metadata = data.metadata || {};
              fullText = this.cleanDetailsAndSummaryTags(fullText);
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
      
      return {text: fullText, conversationId: this.conversationId};
    } catch (error) {
      if (error.name === 'AbortError' || this.abortController.signal.aborted) {
        logger.debug('[DifyClient] 请求被中止');
        return {text: fullText, conversationId: this.conversationId};
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
   * 处理消息内容，将Final Answer标记之前的内容作为思考部分
   * 同时移除HTML中的summary标签及details标签，但保留details内的文本内容
   * @param {string} content - 包含思考内容和回答的文本
   * @returns {string} 格式化后的文本
   */
  cleanDetailsAndSummaryTags(content) {
    if (!content) return '';

    // 清理多余空行
    content = content.replace(/\n{3,}/g, '\n\n');
    
    // 移除所有<summary>标签及其内容
    content = content.replace(/<summary>([\s\S]*?)<\/summary>/g, '');
    
    // 替换<details>标签，只保留其内容
    content = content.replace(/<details[^>]*>([\s\S]*?)<\/details>/g, function(match, innerContent) {
      // 返回details标签内的内容，但不包括标签本身
      return innerContent.trim();
    });
    
    // 查找Final Answer标记
    const finalAnswerIndex = content.indexOf(finalAnswerMarker);
    
    // 如果没有找到标记，直接返回处理后的内容
    if (finalAnswerIndex === -1) {
      return content;
    }
    
    // 将标记之前的内容作为思考部分
    const thinkingContent = content.substring(0, finalAnswerIndex).trim();
    
    // 将标记之后的内容作为正文（移除标记本身）
    const regularContent = content.substring(finalAnswerIndex + finalAnswerMarker.length).trim();
    
    // 如果思考内容不为空，格式化为思考区域
    if (thinkingContent) {
      // 构建最终结果，使用:::thinking:::格式
      return `:::thinking\n${thinkingContent}\n:::\n\n${regularContent}`;
    }
    
    // 如果没有思考内容，只返回正文
    return regularContent;
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
      statusText = `${status}`;
    } else if (type === 'end') {
      // statusText = `完成: ${status}`;
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

  // 添加新的sendToolCallDelta方法
  sendToolCallDelta(stepId, tool, toolInput, observation, progress = 0.5, toolCallId = null) {
    if (!this.res) return;
    
    const id = toolCallId || `tool_${v4()}`; // 使用传入的ID或生成新ID
    
    const toolCallEvent = {
      event: 'on_message_delta',
      data: {
        id: stepId,
        delta: {
          content: [
            {
              type: 'tool_call',
              tool_call: {
                id: id,
                name: tool,
                args: toolInput || '',
                output: observation || '',
                progress: progress
              }
            }
          ]
        }
      }
    };
    
    sendEvent(this.res, toolCallEvent);
    
    // 将工具调用记录到对象中
    this.toolCalls[id] = {
      name: tool,
      args: toolInput || '',
      output: observation || '',
      progress: progress
    };
    
    return id;
  }
}

module.exports = DifyClient; 