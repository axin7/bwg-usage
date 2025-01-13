import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://api.64clouds.com/v1';

export async function POST(request: NextRequest) {
  try {
    const { action, veid, apiKey } = await request.json();
    
    if (!action || !veid || !apiKey) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    if (!['start', 'stop', 'restart'].includes(action)) {
      return NextResponse.json(
        { error: '不支持的操作' },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${API_BASE}/${action}?veid=${veid}&api_key=${apiKey}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    
    if (!response.ok || data.error) {
      return NextResponse.json(
        { error: data.error || '请求失败' },
        { status: response.ok ? 400 : response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
} 