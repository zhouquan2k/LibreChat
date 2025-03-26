/**
 * Dify客户端简易测试工具
 * 解决路径问题的简单方案
 */
const path = require('path');
const axios = require('axios');

// 设置项目根路径别名
const rootDir = path.resolve(__dirname);
require('module-alias').addAliases({
  '~': rootDir
});

// 现在可以导入DifyClient
const DifyClient = require('./app/clients/DifyClient');

// 简单的日志工具
const logger = {
  debug: (...args) => console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  level: 'debug'
};

// 配置
const API_KEY = process.env.DIFY_API_KEY || 'your_api_key_here';
const BASE_URL = process.env.DIFY_BASE_URL || 'http://192.168.157.17/v1';

// 测试直接使用Axios调用Dify API
async function testAxios() {
  console.log('\n==== 测试 Axios 直接调用 ====');
  
  try {
    const response = await axios.post(
      `${BASE_URL}/chat-messages`, 
      {
        query: '你好，请简单介绍一下自己。',
        response_mode: 'blocking',
        user: 'test_user',
        inputs: [],
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Axios 调用成功:', response.status);
    console.log('响应数据:', JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('Axios 调用失败:', error.message);
    
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
    
    return false;
  }
}

// 测试DifyClient非流式调用
async function testDifyClient() {
  console.log('\n==== 测试 DifyClient 非流式调用 ====');
  
  // 模拟Express的req/res对象
  const req = {
    once: (event, callback) => {
      console.log(`注册req.${event}事件`);
    },
    user: { id: 'test_user' }
  };
  
  const res = {
    write: (data) => {
      console.log(`收到流式数据: ${data}`);
      return true;
    },
    end: () => {
      console.log('流结束');
    }
  };
  
  // 注入日志对象到全局配置
  global.logger = logger;
  
  // 创建DifyClient实例
  const client = new DifyClient(API_KEY, {
    reverseProxyUrl: BASE_URL,
    req,
    res
  });
  
  try {
    const response = await client.sendCompletion('你好，请简单介绍一下自己。');
    console.log('DifyClient 调用成功:');
    console.log('响应数据:', JSON.stringify(response, null, 2));
    return true;
  } catch (error) {
    console.error('DifyClient 调用失败:', error.message);
    return false;
  }
}

// 测试DifyClient流式调用
async function testDifyClientStream() {
  console.log('\n==== 测试 DifyClient 流式调用 ====');
  
  // 模拟Express的req/res对象
  
  const req = {
    once: (event, callback) => {
      console.log(`注册req.${event}事件`);
    },
    user: { id: 'test_user' }
  };
  
  // 创建模拟响应对象，用于接收流式数据
  const res = {
    write: (data) => {
      // 解析接收的数据以便调试查看
      try {
        // 这里接收的应该是JSON字符串，而不是SSE格式
        const parsedData = JSON.parse(data);
        console.log(`收到流式响应数据: ${JSON.stringify(parsedData, null, 2)}`);
        
        // 检查是否是最终消息
        if (parsedData.final) {
          console.log('收到最终响应, 完整文本:', parsedData.text);
        }
        // 检查是否有错误
        else if (parsedData.error) {
          console.log('收到错误消息:', parsedData.text);
        }
      } catch (e) {
        console.log(`收到非JSON数据: ${data}`);
        console.error('解析错误:', e.message);
      }
      return true;
    },
    end: () => {
      console.log('流结束');
    }
  };
  
  // 注入日志对象到全局配置
  global.logger = logger;
  
  // 创建DifyClient实例
  const client = new DifyClient(API_KEY, {
    reverseProxyUrl: BASE_URL,
    req,
    res
  });
  
  try {
    console.log('开始发送流式请求...');
    // 使用sendStreamCompletion方法而不是sendCompletionStream
    const result = await client.sendStreamCompletion('请用几句话描述一下春天的景色。', {
      user: 'test_user'
    });
    
    // 这里不会有直接的返回结果，因为流式响应通过res.write发送
    console.log('DifyClient 流式调用已启动');
    console.log('流式调用结果:', result);
    return true;
  } catch (error) {
    console.error('DifyClient 流式调用失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
    return false;
  }
}

// 主函数
async function main() {
  console.log('开始测试Dify API连接');
  console.log(`使用API_KEY: ${API_KEY.substring(0, 5)}***`);
  console.log(`使用BASE_URL: ${BASE_URL}`);
  
  // 获取命令行参数来控制测试模式
  const args = process.argv.slice(2);
  const testMode = args[0] || 'all'; // 默认运行所有测试
  
  console.log(`测试模式: ${testMode}`);
  
  try {
    let axiosSuccess = false;
    let difyClientSuccess = false;
    let difyClientStreamSuccess = false;
    
    // 根据测试模式运行不同的测试
    if (testMode === 'all' || testMode === 'axios') {
      // 1. 测试Axios直接调用
      axiosSuccess = await testAxios();
    } else {
      axiosSuccess = true; // 跳过此测试
      console.log('\n跳过 Axios 直接调用测试');
    }
    
    if (testMode === 'all' || testMode === 'blocking') {
      // 2. 测试DifyClient非流式调用
      difyClientSuccess = await testDifyClient();
    } else {
      difyClientSuccess = true; // 跳过此测试
      console.log('\n跳过 DifyClient 非流式调用测试');
    }
    
    if (testMode === 'all' || testMode === 'stream') {
      // 3. 测试DifyClient流式调用
      difyClientStreamSuccess = await testDifyClientStream();
    } else {
      difyClientStreamSuccess = true; // 跳过此测试
      console.log('\n跳过 DifyClient 流式调用测试');
    }
    
    console.log('\n测试总结:');
    console.log(`- Axios直接调用: ${axiosSuccess ? '成功' : '失败'}`);
    console.log(`- DifyClient非流式调用: ${difyClientSuccess ? '成功' : '失败'}`);
    console.log(`- DifyClient流式调用: ${difyClientStreamSuccess ? '成功' : '失败'}`);
    
    if (axiosSuccess && (!difyClientSuccess || !difyClientStreamSuccess)) {
      console.log('\n可能的问题：');
      console.log('- DifyClient实现与Dify API的请求/响应格式不匹配');
      console.log('- DifyClient中的错误处理有问题');
      console.log('- 环境或配置问题');
    }
  } catch (error) {
    console.error('测试过程中发生错误:', error);
  }
}

// 运行测试
main().catch(error => {
  console.error('执行测试时遇到错误:', error);
}); 