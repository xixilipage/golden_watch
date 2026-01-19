'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Spinner,
  Skeleton,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Switch,
  useDisclosure,
  Select,
  SelectItem
} from '@heroui/react';
import useSWR from 'swr';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import { RefreshCw, TrendingUp, DollarSign, Settings, Calendar } from 'lucide-react';

// --- Types ---
interface GoldData {
  price: string;
  unit: string;
  fullText: string;
}

interface GoldPriceResponse {
  success: boolean;
  data: GoldData;
  timestamp: string;
  source?: string;
}

interface GoldHistoryItem {
  id: number;
  price: number;
  unit: string;
  timestamp: string;
}

interface GoldHistoryResponse {
  success: boolean;
  data: GoldHistoryItem[];
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function GoldDemoPage() {
  // Initialize with '7' but try to read from localStorage on mount
  const [selectedRange, setSelectedRange] = useState<string>('7');

  useEffect(() => {
    const savedRange = localStorage.getItem('gold_price_range');
    if (savedRange && ['7', '30', '90', '365', 'all'].includes(savedRange)) {
      setSelectedRange(savedRange);
    }
  }, []);

  const handleRangeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (!value) return;

    // 如果选择了新的范围，更新状态并记忆
    if (value !== selectedRange) {
      setSelectedRange(value);
      localStorage.setItem('gold_price_range', value);
      return;
    }

    // 如果再次选择同一个范围，则当作一次“刷新”操作
    // 触发价格和历史数据的重新获取，并带有loading动画
    handleRefresh();
  };
  
  // Settings State
  const {isOpen, onOpen, onOpenChange} = useDisclosure();
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [cronEnabled, setCronEnabled] = useState(false);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch Current Price
  const { 
    data: priceData, 
    mutate: mutatePrice, 
    isValidating: isPriceValidating 
  } = useSWR<GoldPriceResponse>('/api/gold-price', fetcher, {
    refreshInterval: 0, // Manual refresh only
    revalidateOnFocus: false,
  });

  // Fetch History
  const { 
    data: historyData, 
    isLoading: isHistoryLoading,
    isValidating: isHistoryValidating,
    mutate: mutateHistory
  } = useSWR<GoldHistoryResponse>(`/api/gold-history?days=${selectedRange}`, fetcher);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Minimum loading time to ensure animation visibility
    const minLoading = new Promise(resolve => setTimeout(resolve, 800));
    await Promise.all([
      mutatePrice(),
      mutateHistory(),
      minLoading
    ]);
    setIsRefreshing(false);
  };

  // Pull to refresh logic
  const [pullProgress, setPullProgress] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  
  // Use refs for gesture tracking to avoid effect re-runs
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullProgressRef = useRef(0);
  
  // Keep latest handleRefresh in a ref to call it from event listeners without re-binding
  const handleRefreshRef = useRef(handleRefresh);
  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  }, [handleRefresh]);

  useEffect(() => {
    const DEADZONE_THRESHOLD = 80; // Must drag 80px before activation (increased from 50)

    const handleTouchStart = (e: TouchEvent) => {
      // Only enable pull to refresh when strictly at the top of the page
      if (window.scrollY === 0) {
        startYRef.current = e.touches[0].clientY;
        // Reset state
        isPullingRef.current = false;
        pullProgressRef.current = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      // If we are not at top, ignore
      if (window.scrollY > 0) {
        if (isPullingRef.current) {
            isPullingRef.current = false;
            setIsPulling(false);
            setPullProgress(0);
        }
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      // Only start pulling if:
      // 1. We are dragging down (diff > DEADZONE_THRESHOLD)
      // 2. We haven't started pulling yet
      if (diff > DEADZONE_THRESHOLD && !isPullingRef.current) {
         isPullingRef.current = true;
         setIsPulling(true);
      }

      if (isPullingRef.current && diff > 0) {
        // Prevent default browser refresh behavior
        if (e.cancelable) {
           e.preventDefault(); 
        }
        
        // Add resistance
        // (diff - DEADZONE_THRESHOLD) is the effective drag distance
        // 0.4 is the resistance factor
        const progress = Math.min((diff - DEADZONE_THRESHOLD) * 0.4, 200); 
        pullProgressRef.current = progress;
        setPullProgress(progress);
      }
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current) return;

      if (pullProgressRef.current > 80) { // Trigger refresh if pulled enough (increased from 60)
        await handleRefreshRef.current();
      }
      
      // Reset
      isPullingRef.current = false;
      pullProgressRef.current = 0;
      setIsPulling(false);
      setPullProgress(0);
    };

    // Add passive: false to allow preventDefault
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // No dependencies = stable listeners

  const chartData = useMemo(() => {
    if (!historyData?.data) return [];
    // Sort by timestamp ascending for chart
    return [...historyData.data]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(item => ({
        ...item,
        timestampVal: new Date(item.timestamp).getTime(),
        dateStr: format(new Date(item.timestamp), 'MM-dd HH:mm'),
        shortDate: format(new Date(item.timestamp), 'MM/dd'),
      }));
  }, [historyData]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const prices = chartData.map(d => d.price);
    const max = Math.max(...prices);
    const min = Math.min(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const first = prices[0];
    const last = prices[prices.length - 1];
    const change = last - first;
    const changePercent = (change / first) * 100;

    return { max, min, avg, change, changePercent };
  }, [chartData]);

  // Fetch settings when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsSettingsLoading(true);
      fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setScrapeUrl(data.data.scrapeUrl || '');
            setCronExpression(data.data.cron?.expression || '0 * * * *');
            setCronEnabled(data.data.cron?.enabled || false);
          }
        })
        .catch(err => console.error('Failed to fetch settings:', err))
        .finally(() => setIsSettingsLoading(false));
    }
  }, [isOpen]);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scrapeUrl,
          cron: {
            enabled: cronEnabled,
            expression: cronExpression
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        onOpenChange(); // Close modal
      } else {
        alert('保存失败: ' + (data.error || '未知错误'));
      }
    } catch (error) {
      alert('保存出错');
    } finally {
      setIsSaving(false);
    }
  };

  const timeRanges = [
    { key: "7", label: "最近7天" },
    { key: "30", label: "最近30天" },
    { key: "90", label: "最近90天" },
    { key: "365", label: "最近一年" },
    { key: "all", label: "全部" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 md:p-8 font-sans">
      
      {/* Pull to refresh indicator */}
      <div 
        className="fixed top-0 left-0 w-full flex justify-center pointer-events-none transition-transform duration-200 z-50"
        style={{ transform: `translateY(${pullProgress > 0 ? pullProgress + 10 : -50}px)` }}
      >
        <div className="bg-white dark:bg-gray-800 rounded-full p-2 shadow-lg border border-gray-100 dark:border-gray-700 flex items-center gap-2">
          {isRefreshing ? (
             <Spinner size="sm" />
          ) : (
             <RefreshCw 
               size={20} 
               className={`text-primary transition-transform duration-300 ${pullProgress > 80 ? 'rotate-180' : ''}`} 
               style={{ opacity: Math.min(pullProgress / 50, 1) }}
             />
          )}
          {pullProgress > 80 && !isRefreshing && <span className="text-xs font-medium text-gray-500">松开刷新</span>}
          {isRefreshing && <span className="text-xs font-medium text-gray-500">更新中...</span>}
        </div>
      </div>

      <div className="max-w-7xl mx-auto space-y-3 md:space-y-6" 
           style={{ 
             transform: `translateY(${pullProgress > 0 ? pullProgress * 0.3 : 0}px)`,
             transition: isPulling ? 'none' : 'transform 0.3s ease-out' 
           }}>
        
        {/* Header Section */}
        <div className="flex justify-between items-center px-1">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <span className="bg-yellow-100 text-yellow-600 p-2 rounded-lg">
                  <DollarSign className="w-6 h-6" />
                </span>
                实时金价追踪
              </h1>
              <Button
                isIconOnly
                variant="light"
                onPress={onOpen}
                className="text-gray-500 hover:text-gray-700"
              >
                <Settings size={20} />
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          
          {/* Left Column: Current Price & Market Overview */}
          <div className="space-y-4 lg:space-y-6">
            
            {/* Current Price Card */}
            <Card className="bg-gradient-to-br from-yellow-500 to-orange-600 text-white border-none shadow-xl">
              <CardBody className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-yellow-100 font-medium mb-1">当前金价</p>
                    <div className="flex items-baseline gap-2">
                      <Skeleton isLoaded={!isPriceValidating} className="rounded-lg bg-white/20">
                        <h2 className="text-5xl font-bold min-h-[48px] min-w-[150px]">
                          {priceData?.data?.price || "---"}
                        </h2>
                      </Skeleton>
                      <span className="text-xl opacity-90">{priceData?.data?.unit || "元/克"}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-white/20 text-white border-white/30 backdrop-blur-md hover:bg-white/30"
                    variant="flat"
                    onPress={handleRefresh}
                    isLoading={isPriceValidating}
                    startContent={!isPriceValidating && <RefreshCw size={14} />}
                  >
                    刷新
                  </Button>
                </div>
                <div className="mt-6 text-sm text-yellow-100/80 flex justify-between items-end">
                  <div>
                    <p>最后更新：</p>
                    <Skeleton isLoaded={!isPriceValidating} className="rounded-md bg-white/20 mt-1">
                      <p className="font-mono min-h-[20px] min-w-[160px]">
                        {priceData?.timestamp 
                          ? format(new Date(priceData.timestamp), 'yyyy-MM-dd HH:mm:ss') 
                          : '获取中...'}
                      </p>
                    </Skeleton>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Market Overview Card */}
            <Card className="shadow-md h-full">
              <CardHeader className="pb-0 pt-4 px-4 flex flex-col items-start gap-3">
                <div className="w-full flex justify-between items-center">
                   <h4 className="font-bold text-large">市场概览</h4>
                   <Select 
                      className="max-w-[130px]" 
                      size="sm" 
                      selectedKeys={[selectedRange]}
                      onChange={handleRangeChange}
                      aria-label="Select time range"
                      disallowEmptySelection
                    >
                      {timeRanges.map((range) => (
                        <SelectItem key={range.key}>
                          {range.label}
                        </SelectItem>
                      ))}
                    </Select>
                </div>
              </CardHeader>
              <CardBody className="py-3 px-3 md:py-4 md:px-4">
                {stats && !isRefreshing && !isHistoryValidating ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg flex flex-col items-center justify-center">
                      <p className="text-xs text-gray-500 mb-1">最高价</p>
                      <p className="text-lg font-semibold text-green-600 leading-tight">{stats.max.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg flex flex-col items-center justify-center">
                      <p className="text-xs text-gray-500 mb-1">最低价</p>
                      <p className="text-lg font-semibold text-red-600 leading-tight">{stats.min.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg flex flex-col items-center justify-center">
                      <p className="text-xs text-gray-500 mb-1">平均价</p>
                      <p className="text-lg font-semibold text-blue-600 leading-tight">{stats.avg.toFixed(2)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg flex flex-col items-center justify-center">
                      <p className="text-xs text-gray-500 mb-1">涨跌幅</p>
                      <div className={`text-lg font-semibold flex items-center justify-center leading-tight ${stats.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {stats.change > 0 ? '+' : ''}{stats.changePercent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <Spinner size="lg" />
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Right Column: Historical Chart */}
          <div className="lg:col-span-2">
            <Card className="h-full shadow-md min-h-[250px]">
             <CardHeader className="flex flex-row justify-between items-center p-6 pt-0 lg:pt-6 pb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  <h3 className="text-xl font-bold">价格走势</h3>
                </div>
                <div className="text-small text-default-500">
                  {timeRanges.find(r => r.key === selectedRange)?.label}趋势
                </div>
              </CardHeader>
              <CardBody className="px-2 pb-4">
                {isHistoryLoading || isHistoryValidating || isRefreshing ? (
                  <div className="h-full flex items-center justify-center">
                    <Spinner label="加载历史数据..." color="primary" />
                  </div>
                ) : (
                  <div className="w-full h-[280]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#EAB308" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#EAB308" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis 
                          dataKey="timestampVal"
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          axisLine={false}
                          tickLine={false}
                          tick={{fill: '#6B7280', fontSize: 12}}
                          minTickGap={30}
                          tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                        />
                        <YAxis 
                          domain={['auto', 'auto']}
                          axisLine={false}
                          tickLine={false}
                          tick={{fill: '#6B7280', fontSize: 12}}
                          tickFormatter={(value) => `¥${value}`}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                            borderRadius: '12px', 
                            border: 'none', 
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' 
                          }}
                          labelStyle={{ color: '#6B7280', marginBottom: '4px' }}
                          labelFormatter={(value) => format(new Date(value), 'yyyy-MM-dd HH:mm:ss')}
                          formatter={(value: any) => [`¥${Number(value).toFixed(2)}`, '价格']}
                        />
                        <Area 
                          type="linear" 
                          dataKey="price" 
                          stroke="#EAB308" 
                          strokeWidth={3}
                          fillOpacity={1} 
                          fill="url(#colorPrice)" 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
          
        </div>
      </div>

      {/* Settings Modal */}
      <Modal 
        isOpen={isOpen} 
        onOpenChange={onOpenChange}
        scrollBehavior="inside"
        placement="top-center"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">系统设置</ModalHeader>
              <ModalBody>
                {isSettingsLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner label="加载设置..." />
                  </div>
                ) : (
                  <div className="space-y-4 pb-12">
                    <div>
                      <p className="text-small font-bold text-gray-500 mb-2">爬虫设置</p>
                      <Input
                        label="目标 URL"
                        placeholder="输入金价页面地址"
                        value={scrapeUrl}
                        onValueChange={setScrapeUrl}
                        variant="bordered"
                      />
                    </div>
                    <div className="pt-2">
                      <p className="text-small font-bold text-gray-500 mb-2">定时任务</p>
                      <div className="flex items-center justify-between mb-4 bg-gray-50 p-3 rounded-lg">
                        <span className="text-sm">启用自动爬取</span>
                        <Switch isSelected={cronEnabled} onValueChange={setCronEnabled} />
                      </div>
                      <Input
                        label="Cron 表达式"
                        placeholder="例如: 0 * * * *"
                        value={cronExpression}
                        onValueChange={setCronExpression}
                        variant="bordered"
                        description="标准 Cron 语法 (分 时 日 月 周)"
                        isDisabled={!cronEnabled}
                      />
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={onClose}>
                  取消
                </Button>
                <Button color="primary" onPress={handleSaveSettings} isLoading={isSaving}>
                  保存配置
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
