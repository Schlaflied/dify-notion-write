// 这是一个 Vercel Serverless Function (Node.js) 文件。
// 文件名：api/write-notion.js
// 作用：接收 Dify Agent 的评估结果，执行 Notion 的“创建记录 -> 获取 ID -> 更新记录”链式操作。

import { Client } from '@notionhq/client';

// -----------------------------------------------------
// 1. 初始化配置 (从 Vercel 环境变量中获取)
// -----------------------------------------------------

// VERCEL 部署提示：
// 请在 Vercel 环境变量中设置 NOTION_TOKEN 和 NOTION_DATABASE_ID
// NOTION_TOKEN: YOUR_NOTION_TOKEN
// NOTION_DATABASE_ID: YOUR_NOTION_DATABASE_ID

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// 检查环境变量是否已设置
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    console.error("Notion tokens/IDs are missing from environment variables.");
    // 如果在 Vercel 环境中未设置，函数将无法正常工作
}

const notion = new Client({ auth: NOTION_TOKEN });

// -----------------------------------------------------
// 2. 主处理函数 (这是 Vercel Function 的入口)
// -----------------------------------------------------
export default async function handler(req, res) {
    // 检查请求方法，只接受 Dify Agent 发出的 POST 请求
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // 再次检查初始化是否成功
    if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
        return res.status(500).json({ 
            status: 'error', 
            message: 'Server configuration error: Notion environment variables not set.',
        });
    }

    // Dify Agent 会将 Function Call 的参数作为 JSON Body 发送过来
    const { 
        inspiration_content, // 原始灵感内容
        priority_result,     // 评估优先级 (高/中/低)
        suggestion_detail    // 具体的行动建议
    } = req.body;

    // 检查必需的输入字段
    if (!inspiration_content || !priority_result || !suggestion_detail) {
        console.error("Missing required fields in Dify request body:", req.body);
        return res.status(400).json({ 
            error: 'Missing required parameters from Dify Agent Function Call.',
            received: req.body 
        });
    }

    let createdPageId = null;

    try {
        // --- A. 创建新记录 (Notion Create Page) ---
        // 状态设置为“待处理”
        const createResponse = await notion.pages.create({
            parent: {
                database_id: NOTION_DATABASE_ID,
            },
            properties: {
                // 假设你的 Notion Database 属性名称如下：
                '灵感内容': {
                    title: [
                        {
                            text: {
                                content: inspiration_content.substring(0, 100) + (inspiration_content.length > 100 ? '...' : ''),
                            },
                        },
                    ],
                },
                '状态': { // 初始状态：待处理
                    select: {
                        name: '待处理', 
                    },
                },
            },
            // 在 Page Content 中写入完整的灵感内容
            children: [
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: inspiration_content,
                                },
                            },
                        ],
                    },
                },
            ],
        });

        // --- B. 捕获新记录的 Item ID ---
        createdPageId = createResponse.id;
        console.log(`Successfully created Notion page with ID: ${createdPageId}`);


        // --- C. 更新记录 (Notion Update Page) ---
        // 使用 Agent 评估结果回写，并将状态更新为“已处理”
        await notion.pages.update({
            page_id: createdPageId,
            properties: {
                // VERCEL 部署提示：请确保下面的属性名 ('优先级' 和 'AI 建议') 与你的 Notion 数据库完全一致！
                '优先级': { // Dify Agent 的评估结果
                    select: {
                        name: priority_result, // 必须是 '高', '中', '低' 之一
                    },
                },
                'AI 建议': { // Dify Agent 的建议
                    rich_text: [
                        {
                            text: {
                                content: suggestion_detail,
                            },
                        },
                    ],
                },
                '状态': { // 最终状态：已处理
                    select: {
                        name: '已处理',
                    },
                },
            },
        });
        
        console.log(`Successfully updated Notion page ID: ${createdPageId} with assessment.`);

        // --- D. 返回 Dify 期望的成功响应 ---
        return res.status(200).json({ 
            status: 'success', 
            message: `Notion page ${createdPageId} created and updated successfully.`,
            priority: priority_result
        });

    } catch (error) {
        console.error('Notion API Error:', error);
        // 如果创建成功但更新失败，通知 Dify 发生了错误
        return res.status(500).json({ 
            status: 'error', 
            message: 'Failed to complete Notion chain operation.',
            details: error.message,
            notionItemId: createdPageId
        });
    }
}
