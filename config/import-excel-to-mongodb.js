#!/usr/bin/env node
/**
 * Excel数据导入MongoDB脚本 (Node.js版本)
 * 将Excel文件中的数据导入到MongoDB数据库中
 * 注意：A列将被导入为username字段
 */

const XLSX = require('xlsx');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 配置参数
const CONFIG = {
    excelFile: 'user_import.xlsx',
    mongodbUrl: 'mongodb://host.docker.internal:27017',
    databaseName: 'LibreChat',
    collectionName: 'users',
    batchSize: 1000,
    // 动态添加的固定字段
    dynamicFields: {
        role: 'USER',              // 用户角色
        provider: 'import',        // 创建来源
        password: '$2a$10$7uRf0H1wYqbnRBtyPZP9ruUkNvWDv5RYqEzgqRwkTqmcnpEnnXRHW',        // 默认密码
    },
    // 动态字段生成器 - 基于现有数据生成新字段
    dynamicFieldGenerators: {
        // 生成唯一email地址
        email: (doc) => {
            const username = doc.username || 'unknown';
            return `${username}_${doc.name}_${doc.phone}@import.local`;
        },
        
        // 生成显示名称（如果name为空）
        // displayName: (doc) => doc.name || doc.username,
    }
};

class ExcelToMongoDB {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.db = null;
        this.collection = null;
        this.logFile = 'import_log.txt';
    }

    /**
     * 记录日志
     */
    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `${timestamp} - ${level} - ${message}`;
        
        console.log(logMessage);
        
        // 写入日志文件
        fs.appendFileSync(this.logFile, logMessage + '\n', 'utf8');
    }

    /**
     * 连接MongoDB数据库
     */
    async connectMongoDB() {
        try {
            this.client = new MongoClient(this.config.mongodbUrl);
            await this.client.connect();
            
            // 测试连接
            await this.client.db('admin').admin().ping();
            
            this.db = this.client.db(this.config.databaseName);
            this.collection = this.db.collection(this.config.collectionName);
            
            this.log(`成功连接到MongoDB: ${this.config.mongodbUrl}`);
            this.log(`数据库: ${this.config.databaseName}, 集合: ${this.config.collectionName}`);
            return true;
        } catch (error) {
            this.log(`连接MongoDB失败: ${error.message}`, 'ERROR');
            return false;
        }
    }

    /**
     * 读取Excel文件
     */
    readExcel(filePath) {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(filePath)) {
                this.log(`Excel文件不存在: ${filePath}`, 'ERROR');
                return null;
            }

            // 读取Excel文件
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0]; // 读取第一个工作表
            const worksheet = workbook.Sheets[sheetName];
            
            // 转换为JSON数组
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
                header: 1, // 使用数组格式，第一行也作为数据
                defval: null // 空单元格默认值
            });

            this.log(`成功读取Excel文件: ${filePath}`);
            this.log(`工作表名称: ${sheetName}`);
            this.log(`数据行数: ${jsonData.length}`);
            this.log(`列数: ${jsonData.length > 0 ? jsonData[0].length : 0}`);

            return jsonData;
        } catch (error) {
            this.log(`读取Excel文件失败: ${error.message}`, 'ERROR');
            return null;
        }
    }

    /**
     * 处理Excel数据，准备导入MongoDB
     */
    processData(excelData) {
        try {
            if (!excelData || excelData.length === 0) {
                this.log('没有数据需要处理', 'WARNING');
                return [];
            }

            const documents = [];
            
            // 获取表头信息（如果第一行是表头）
            const hasHeader = excelData.length > 1 && 
                              typeof excelData[0][0] === 'string' && 
                              excelData[0][0].trim() !== '';
            
            const startRow = hasHeader ? 1 : 0; // 如果有表头则从第二行开始
            const headers = hasHeader ? excelData[0] : [];

            this.log(`检测到表头: ${hasHeader ? '是' : '否'}`);
            if (hasHeader) {
                this.log(`表头信息: ${JSON.stringify(headers)}`);
            }

            for (let i = startRow; i < excelData.length; i++) {
                const row = excelData[i];
                
                // 跳过空行
                if (!row || row.every(cell => cell === null || cell === undefined || cell === '')) {
                    continue;
                }

                // 创建文档
                const doc = {
                    username: this.convertValue(row[2], 'string'), // C列作为username
                    import_time: new Date(),
                    row_index: i + 1
                };

                // 添加动态字段
                if (this.config.dynamicFields) {
                    Object.keys(this.config.dynamicFields).forEach(key => {
                        doc[key] = this.config.dynamicFields[key];
                    });
                }

                // 添加A列和B列数据，忽略其他列
                for (let j = 0; j < Math.min(row.length, 2); j++) {
                    const value = this.convertValue(row[j]);
                    
                    // 强制使用预定义的字段名
                    let fieldName;
                    if (j === 0) {
                        fieldName = 'name';  // A列固定为name
                    } else if (j === 1) {
                        fieldName = 'phone'; // B列固定为phone
                    } else {
                        // 其他列使用表头名称或默认名称
                        if (hasHeader && headers[j]) {
                            fieldName = String(headers[j]).trim();
                            fieldName = fieldName.replace(/[^\w\u4e00-\u9fa5]/g, '_');
                        } else {
                            fieldName = `field_${j + 1}`;
                        }
                    }

                    if (fieldName) {
                        doc[fieldName] = value;
                    }
                }

                // 应用动态字段生成器
                if (this.config.dynamicFieldGenerators) {
                    Object.keys(this.config.dynamicFieldGenerators).forEach(key => {
                        const generator = this.config.dynamicFieldGenerators[key];
                        if (typeof generator === 'function') {
                            try {
                                doc[key] = generator(doc);
                            } catch (error) {
                                this.log(`动态字段生成器 ${key} 执行失败: ${error.message}`, 'WARNING');
                            }
                        }
                    });
                }

                documents.push(doc);
            }

            this.log(`处理完成，共准备 ${documents.length} 条记录`);
            return documents;

        } catch (error) {
            this.log(`处理数据失败: ${error.message}`, 'ERROR');
            return [];
        }
    }

    /**
     * 转换数据值
     */
    convertValue(value, forceType = null) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        if (forceType === 'string') {
            return String(value);
        }

        // 保持数字类型
        if (typeof value === 'number') {
            return value;
        }

        // 处理日期
        if (value instanceof Date) {
            return value;
        }

        // 其他类型转换为字符串
        return String(value);
    }

    /**
     * 将数据导入MongoDB
     */
    async importToMongoDB(documents) {
        try {
            if (!documents || documents.length === 0) {
                this.log('没有数据需要导入', 'WARNING');
                return false;
            }

            let totalImported = 0;
            
            // 批量插入
            for (let i = 0; i < documents.length; i += this.config.batchSize) {
                const batch = documents.slice(i, i + this.config.batchSize);
                
                const result = await this.collection.insertMany(batch);
                totalImported += result.insertedCount;
                
                this.log(`已导入 ${totalImported}/${documents.length} 条记录`);
            }

            this.log(`数据导入完成！总共导入 ${totalImported} 条记录`);
            return true;

        } catch (error) {
            this.log(`导入数据到MongoDB失败: ${error.message}`, 'ERROR');
            return false;
        }
    }

    /**
     * 为username字段创建索引
     */
    async createIndex() {
        try {
            await this.collection.createIndex({ username: 1 });
            this.log('已为username字段创建索引');
        } catch (error) {
            this.log(`创建索引失败: ${error.message}`, 'WARNING');
        }
    }

    /**
     * 关闭MongoDB连接
     */
    async closeConnection() {
        if (this.client) {
            await this.client.close();
            this.log('已关闭MongoDB连接');
        }
    }

    /**
     * 显示数据预览
     */
    showPreview(documents, limit = 3) {
        if (!documents || documents.length === 0) {
            return;
        }

        this.log('处理后的数据预览:');
        const preview = documents.slice(0, limit);
        preview.forEach((doc, index) => {
            this.log(`第${index + 1}条记录: ${JSON.stringify(doc, null, 2)}`);
        });
    }

    /**
     * 获取用户确认
     */
    async getUserConfirmation(documents) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            console.log(`\n准备导入 ${documents.length} 条记录到MongoDB`);
                         console.log(`数据库: ${this.config.databaseName}`);
             console.log(`集合: ${this.config.collectionName}`);
             console.log(`映射关系: A列->name, B列->phone, C列->username`);
            
            rl.question('是否继续导入？(y/N): ', (answer) => {
                rl.close();
                const confirmed = ['y', 'yes', 'Y', 'YES'].includes(answer.trim());
                resolve(confirmed);
            });
        });
    }
}

/**
 * 主函数
 */
async function main() {
    const importer = new ExcelToMongoDB(CONFIG);
    
    try {
        // 清空日志文件
        fs.writeFileSync(importer.logFile, '', 'utf8');
        
        importer.log('开始Excel数据导入流程');
        
        // 检查Excel文件是否存在
        if (!fs.existsSync(CONFIG.excelFile)) {
            importer.log(`Excel文件不存在: ${CONFIG.excelFile}`, 'ERROR');
            process.exit(1);
        }

        // 连接MongoDB
        if (!(await importer.connectMongoDB())) {
            importer.log('无法连接到MongoDB，程序退出', 'ERROR');
            process.exit(1);
        }

        // 读取Excel文件
        const excelData = importer.readExcel(CONFIG.excelFile);
        if (!excelData) {
            importer.log('无法读取Excel文件，程序退出', 'ERROR');
            process.exit(1);
        }

        // 显示原始数据预览
        importer.log('Excel原始数据预览:');
        if (excelData.length > 0) {
            importer.log(`前3行数据: ${JSON.stringify(excelData.slice(0, 3), null, 2)}`);
        }

        // 处理数据
        const documents = importer.processData(excelData);
        if (!documents || documents.length === 0) {
            importer.log('数据处理失败或没有有效数据，程序退出', 'ERROR');
            process.exit(1);
        }

        // 显示处理后的数据预览
        importer.showPreview(documents);

        // 获取用户确认
        const confirmed = await importer.getUserConfirmation(documents);
        if (!confirmed) {
            importer.log('用户取消导入操作');
            return;
        }

        // 导入数据
        if (await importer.importToMongoDB(documents)) {
            // 创建索引
            await importer.createIndex();
            importer.log('导入完成！');
        } else {
            importer.log('导入失败！', 'ERROR');
            process.exit(1);
        }

    } catch (error) {
        importer.log(`程序执行出错: ${error.message}`, 'ERROR');
        console.error(error);
        process.exit(1);
    } finally {
        // 关闭连接
        await importer.closeConnection();
    }
}

// 处理进程中断
process.on('SIGINT', async () => {
    console.log('\n用户中断操作');
    process.exit(0);
});

// 运行主函数
if (require.main === module) {
    main().catch(console.error);
}

module.exports = ExcelToMongoDB; 