'use client';

import { ArrowLeft, CheckCircle2, Download, Trash2, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import {
  clearOfflineItems,
  deleteOfflineItem,
  formatBytes,
  getOfflineItems,
  OfflineCacheItem,
} from '@/lib/offlineCache.client';

export default function CachePage() {
  const [items, setItems] = useState<OfflineCacheItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await getOfflineItems());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (key: string) => {
    await deleteOfflineItem(key);
    await load();
  };

  const clearAll = async () => {
    if (!window.confirm('确定要删除全部离线缓存吗？')) return;
    await clearOfflineItems();
    await load();
  };

  const totalSize = items.reduce((sum, item) => sum + item.size, 0);
  const readyCount = items.filter((item) => item.status === 'ready').length;

  return (
    <PageLayout activePath='/cache'>
      <div className='mx-auto w-full max-w-5xl px-5 py-6 md:px-8'>
        <div className='mb-6 flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <Link
              href='/'
              className='rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='返回首页'
            >
              <ArrowLeft className='h-5 w-5' />
            </Link>
            <div>
              <h1 className='text-2xl font-bold'>离线缓存</h1>
              <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
                {readyCount} 个视频 · 共 {formatBytes(totalSize)}
              </p>
            </div>
          </div>

          {items.length > 0 && (
            <button
              onClick={clearAll}
              className='rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30'
            >
              清空全部
            </button>
          )}
        </div>

        {loading ? (
          <div className='rounded-xl border border-gray-200 p-10 text-center text-gray-500 dark:border-gray-800'>
            正在读取缓存...
          </div>
        ) : items.length === 0 ? (
          <div className='rounded-2xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-700'>
            <WifiOff className='mx-auto mb-4 h-12 w-12 text-gray-400' />
            <h2 className='text-lg font-semibold'>还没有离线缓存</h2>
            <p className='mt-2 text-sm text-gray-500'>
              在播放页面点击“缓存当前集”，即可在无网络时观看。
            </p>
            <Link
              href='/'
              className='mt-6 inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700'
            >
              <Download className='h-4 w-4' />
              去找影片
            </Link>
          </div>
        ) : (
          <div className='space-y-3'>
            {items.map((item) => (
              <div
                key={item.key}
                className='flex gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900'
              >
                {item.cover ? (
                  <img
                    src={item.cover}
                    alt=''
                    className='h-24 w-16 flex-shrink-0 rounded object-cover'
                  />
                ) : (
                  <div className='flex h-24 w-16 flex-shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800'>
                    <Download className='h-5 w-5 text-gray-400' />
                  </div>
                )}

                <div className='min-w-0 flex-1'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h2 className='truncate font-semibold'>{item.title}</h2>
                      <p className='mt-1 text-sm text-gray-500'>
                        {item.episodeLabel} · {formatBytes(item.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => void remove(item.key)}
                      className='rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30'
                      title='删除缓存'
                    >
                      <Trash2 className='h-4 w-4' />
                    </button>
                  </div>

                  {item.status === 'ready' ? (
                    <div className='mt-3 flex items-center gap-2 text-sm text-green-600'>
                      <CheckCircle2 className='h-4 w-4' />
                      已缓存，可离线观看
                      <Link
                        href={`/play?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.contentId)}&title=${encodeURIComponent(item.title)}&episode=${item.episodeIndex}&offline=true`}
                        className='ml-auto rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700'
                      >
                        播放
                      </Link>
                    </div>
                  ) : item.status === 'downloading' ? (
                    <div className='mt-3'>
                      <div className='mb-1 flex justify-between text-xs text-gray-500'>
                        <span>正在缓存</span>
                        <span>{item.progress}%</span>
                      </div>
                      <div className='h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700'>
                        <div
                          className='h-full rounded-full bg-green-500 transition-all'
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className='mt-3 text-sm text-red-500'>
                      缓存失败：{item.error || '未知错误'}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
