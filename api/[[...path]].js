/* ========================================
   api/[[...path]].js — 单入口路由分发
   所有 /api/* 请求由此处理
   ======================================== */
import { handleAuth } from '../lib/auth-handler.js';
import { handleData } from '../lib/data-handler.js';

function extractPath(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  // 去掉 /api/ 前缀，返回子路径
  if (pathname === '/api') return '';
  return pathname.replace(/^\/api\//, '');
}

async function handler(req) {
  const path = extractPath(req);

  // /api/auth/* → 认证路由
  if (path === '' || path.startsWith('auth/') || path === 'auth') {
    const subPath = path.replace(/^auth\/?/, '');
    return handleAuth(subPath, req);
  }

  // /api/data/* → 数据 CRUD 路由
  if (path.startsWith('data/') || path === 'data') {
    const subPath = path.replace(/^data\/?/, '');
    return handleData(subPath, req);
  }

  return new Response(JSON.stringify({ success: false, error: '接口不存在' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function GET(req) { return handler(req); }
export async function POST(req) { return handler(req); }
export async function PUT(req) { return handler(req); }
export async function DELETE(req) { return handler(req); }
