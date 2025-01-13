import { NextRequest, NextResponse } from 'next/server';
import { VPSData } from '@/types';

const API_BASE = 'https://api.64clouds.com/v1';

function transformData(rawData: any): VPSData {
  const resetDate = new Date(rawData.data_next_reset * 1000);
  
  const now = new Date();
  const daysRemaining = Math.ceil((resetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  const totalGB = rawData.plan_monthly_data / (1024 * 1024 * 1024);
  const usedGB = rawData.data_counter / (1024 * 1024 * 1024);
  const percentUsed = (usedGB / totalGB) * 100;
  
  const monthStart = new Date(resetDate);
  monthStart.setMonth(monthStart.getMonth() - 1);
  const daysPassed = Math.ceil((now.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24));
  const dailyAverage = (daysPassed > 0 ? (usedGB / daysPassed) : 0).toFixed(2);

  return {
    basic: {
      hostname: rawData.hostname || rawData.node_alias || '未知主机',
      node_location: rawData.node_location || '未知位置',
      os: rawData.os || '未知系统',
      ip_addresses: rawData.ip_addresses || [],
      vm_type: rawData.vm_type || '未知类型',
      node_datacenter: rawData.node_datacenter || '未知数据中心',
    },
    resources: {
      totalGB: totalGB.toFixed(2),
      usedGB: usedGB.toFixed(2),
      percentUsed: Math.min(100, Math.max(0, percentUsed)),
      plan_disk: rawData.plan_disk || 0,
      plan_ram: rawData.plan_ram || 0,
      plan_swap: rawData.plan_swap || 0,
      plan: rawData.plan || '未知计划',
    },
    status: {
      resetDate: resetDate.toLocaleDateString('zh-CN'),
      daysRemaining: daysRemaining,
      dailyAverage: dailyAverage,
      suspended: rawData.suspended || false,
      policy_violation: rawData.policy_violation || false,
    },
    network: {
      location_ipv6_ready: rawData.location_ipv6_ready || false,
      plan_private_network_available: rawData.plan_private_network_available || false,
      location_private_network_available: rawData.location_private_network_available || false,
      rdns_api_available: rawData.rdns_api_available || false,
    }
  };
}

export async function POST(request: NextRequest) {
  try {
    const { veid, apiKey } = await request.json();
    
    if (!veid || !apiKey) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${API_BASE}/getServiceInfo?veid=${veid}&api_key=${apiKey}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    const rawData = await response.json();
    
    if (!response.ok || rawData.error) {
      return NextResponse.json(
        { error: rawData.error || '请求失败' },
        { status: response.ok ? 400 : response.status }
      );
    }

    const transformedData = transformData(rawData);
    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
} 