'use client';

import { useState, useEffect } from 'react';
import { VPSCredentials, VPSData } from '@/types';
import { fetchVPSData, performVPSAction } from '@/lib/api';
import { Card, CardBody, CardHeader, Button, Progress, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@nextui-org/react";
import { motion } from "framer-motion";

interface VPSCardProps {
  onReset: () => void;
}

type ActionType = 'start' | 'stop' | 'restart';

interface ActionConfig {
  title: string;
  description: string;
  color: "success" | "danger" | "warning";
  icon?: React.ReactNode;
}

const ACTION_CONFIGS: Record<ActionType, ActionConfig> = {
  start: {
    title: "启动 VPS",
    description: "确定要启动 VPS 吗？",
    color: "success",
  },
  stop: {
    title: "停止 VPS",
    description: "确定要停止 VPS 吗？这将中断所有正在运行的服务。",
    color: "danger",
  },
  restart: {
    title: "重启 VPS",
    description: "确定要重启 VPS 吗？这将暂时中断所有服务。",
    color: "warning",
  },
};

export function VPSCard({ onReset }: VPSCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentAction, setCurrentAction] = useState<ActionType | null>(null);
  const [credentials, setCredentials] = useState<VPSCredentials>(() => {
    if (typeof window === 'undefined') return { veid: '', apiKey: '' };
    
    try {
      const saved = localStorage.getItem('vps_credentials');
      const parsed = saved ? JSON.parse(saved) : { veid: '', apiKey: '' };
      return parsed && parsed.veid && parsed.apiKey ? parsed : { veid: '', apiKey: '' };
    } catch (error) {
      return { veid: '', apiKey: '' };
    }
  });

  const [isConfigured, setIsConfigured] = useState(() => {
    if (typeof window === 'undefined') return false;
    
    try {
      const saved = localStorage.getItem('vps_credentials');
      const parsed = saved ? JSON.parse(saved) : null;
      return !!(parsed && parsed.veid && parsed.apiKey);
    } catch (error) {
      return false;
    }
  });

  const [data, setData] = useState<VPSData>({
    basic: {
      hostname: '--',
      node_location: '--',
      os: '--',
      ip_addresses: [],
    },
    resources: {
      totalGB: '--',
      usedGB: '--',
      percentUsed: 0,
      plan_disk: 0,
      plan_ram: 0,
      plan_swap: 0,
    },
    status: {
      resetDate: '--',
      daysRemaining: '--',
      dailyAverage: '--',
    }
  });

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const fetchData = async () => {
    if (!isConfigured) return;
    
    try {
      setLoading(true);
      setError(null);
      const response = await fetchVPSData(credentials);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!isConfigured) return;
    
    try {
      setLoading(true);
      setError(null);
      await performVPSAction(action, credentials);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newCredentials = {
      veid: formData.get('veid') as string,
      apiKey: formData.get('apiKey') as string,
    };
    
    setCredentials(newCredentials);
    localStorage.setItem('vps_credentials', JSON.stringify(newCredentials));
    setIsConfigured(true);
  };

  useEffect(() => {
    if (isConfigured && isMounted) {
      fetchData();
      const interval = setInterval(fetchData, 30000);
      return () => clearInterval(interval);
    }
  }, [isConfigured, isMounted]);

  const handleActionClick = (action: ActionType) => {
    setCurrentAction(action);
    setIsModalOpen(true);
  };

  const handleActionConfirm = async () => {
    if (!currentAction) return;
    
    setIsModalOpen(false);
    await handleAction(currentAction);
    setCurrentAction(null);
  };

  if (!isMounted) {
    return null;
  }

  if (!isConfigured) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        className="max-w-[800px] mx-auto px-4 py-6"
      >
        <Card className="bg-white shadow-lg hover:shadow-xl transition-shadow">
          <CardHeader className="flex justify-between items-center px-6 pt-6 pb-4">
            <h3 className="text-xl font-semibold">VPS 信息</h3>
            <Button 
              color="primary" 
              variant="light"
              size="sm"
              onPress={onReset}
              className="min-w-[80px]"
            >
              重置配置
            </Button>
          </CardHeader>
          <CardBody className="px-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="veid" className="text-sm text-default-700">VEID:</label>
                  <input
                    type="text"
                    id="veid"
                    name="veid"
                    required
                    placeholder="输入 VEID"
                    className="w-full px-3 py-2 rounded-lg border border-default-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="apiKey" className="text-sm text-default-700">API Key:</label>
                  <input
                    type="password"
                    id="apiKey"
                    name="apiKey"
                    required
                    placeholder="输入 API Key"
                    className="w-full px-3 py-2 rounded-lg border border-default-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
              <Button
                type="submit"
                color="primary"
                className="w-full"
              >
                保存
              </Button>
            </form>
          </CardBody>
        </Card>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        className="max-w-[800px] mx-auto px-4 py-6"
      >
        <Card className="bg-white shadow-lg hover:shadow-xl transition-shadow">
          <CardHeader className="flex justify-between items-center px-6 pt-6 pb-4">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {data?.basic?.hostname || '未知主机'}
              </h2>
              <p className="text-default-500 mt-1">
                {data?.basic?.node_location || '未知位置'}
              </p>
            </div>
            <Button 
              color="primary" 
              variant="light"
              size="sm"
              onPress={onReset}
              className="min-w-[80px]"
            >
              重置配置
            </Button>
          </CardHeader>
          
          <CardBody className="px-6 pb-6">
            <div className="grid grid-cols-2 gap-6 mb-8 bg-default-50 p-4 rounded-xl">
              <div className="space-y-1.5">
                <p className="text-small text-default-500">系统</p>
                <p className="text-medium font-semibold">
                  {data?.basic?.os || '--'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-small text-default-500">IP</p>
                <p className="text-medium font-semibold break-all">
                  {data?.basic?.ip_addresses?.join(', ') || '--'}
                </p>
              </div>
            </div>

            <div className="space-y-6 mb-8 bg-white p-4 rounded-xl border border-default-200">
              <div className="flex justify-between items-center">
                <h3 className="text-medium font-semibold">流量使用情况</h3>
                <Chip
                  color={data?.resources?.percentUsed > 80 ? "danger" : "primary"}
                  variant="flat"
                  size="sm"
                  className="font-medium"
                >
                  {data?.resources?.percentUsed?.toFixed(1) || 0}%
                </Chip>
              </div>
              
              <Progress 
                value={data?.resources?.percentUsed || 0}
                color={data?.resources?.percentUsed > 80 ? "danger" : "primary"}
                className="h-2"
                aria-label="流量使用进度"
              />
              
              <div className="flex justify-between text-small text-default-600">
                <span>已用: {data?.resources?.usedGB || '--'} GB</span>
                <span>总量: {data?.resources?.totalGB || '--'} GB</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-8 bg-default-50 p-4 rounded-xl">
              <div className="space-y-1.5">
                <p className="text-small text-default-500">重置日期</p>
                <p className="text-medium font-semibold">
                  {data?.status?.resetDate || '--'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-small text-default-500">剩余天数</p>
                <p className="text-medium font-semibold">
                  {data?.status?.daysRemaining || '--'} 天
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-small text-default-500">日均使用</p>
                <p className="text-medium font-semibold">
                  {data?.status?.dailyAverage || '--'} GB
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Button
                color="success"
                variant="flat"
                onPress={() => handleActionClick('start')}
                isLoading={loading}
                className="font-medium"
                startContent={<PowerIcon />}
              >
                启动
              </Button>
              <Button
                color="danger"
                variant="flat" 
                onPress={() => handleActionClick('stop')}
                isLoading={loading}
                className="font-medium"
                startContent={<StopIcon />}
              >
                停止
              </Button>
              <Button
                color="warning"
                variant="flat"
                onPress={() => handleActionClick('restart')}
                isLoading={loading}
                className="font-medium"
                startContent={<RestartIcon />}
              >
                重启
              </Button>
            </div>

            {error && (
              <div className="mt-6 p-4 bg-danger-50 text-danger-600 rounded-lg text-small">
                {error}
              </div>
            )}

            {loading && (
              <div className="mt-6 text-center text-default-500 text-small">
                加载中...
              </div>
            )}
          </CardBody>
        </Card>
      </motion.div>

      <Modal 
        isOpen={isModalOpen} 
        onOpenChange={setIsModalOpen}
        onClose={() => setCurrentAction(null)}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {currentAction && ACTION_CONFIGS[currentAction].title}
              </ModalHeader>
              <ModalBody>
                <p className="text-default-600">
                  {currentAction && ACTION_CONFIGS[currentAction].description}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button 
                  color="default" 
                  variant="light" 
                  onPress={onClose}
                >
                  取消
                </Button>
                <Button 
                  color={currentAction ? ACTION_CONFIGS[currentAction].color : "primary"}
                  onPress={handleActionConfirm}
                  isLoading={loading}
                >
                  确认
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

// 图标组件
function PowerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="16" 
      height="16" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
      <line x1="12" y1="2" x2="12" y2="12"/>
    </svg>
  );
}

function StopIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="16" 
      height="16" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  );
}

function RestartIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="16" 
      height="16" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 2v6h-6"/>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
      <path d="M3 22v-6h6"/>
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
    </svg>
  );
} 