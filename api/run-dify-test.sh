# 设置环境变量
export DIFY_API_KEY="app-mwDv28xELLBnvcn3S8lzRPhQ"
export DIFY_BASE_URL="http://192.168.1.227:4080/v1"

export CREDS_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
export CREDS_IV="0123456789abcdef0123456789abcdef"


# 安装依赖
#echo "安装必要的依赖..."
#npm install --no-save axios module-alias

# 运行测试
echo "运行Dify客户端测试..."
node test-dify-simple.js 