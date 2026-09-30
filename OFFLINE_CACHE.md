# MoonTV 离线缓存功能

本版本在现有播放器基础上增加浏览器端 HLS 离线缓存。

## 功能

- 播放页「缓存当前集」
- 多集剧集「缓存全部」
- 下载进度显示
- IndexedDB 持久化视频分片
- 播放时自动优先使用本地缓存
- `/cache` 离线缓存管理页
- 删除单个缓存 / 清空全部缓存
- 从缓存管理页进入播放时支持完全无网络恢复已缓存内容
- HLS AES-128 key 与 `EXT-X-MAP` 初始化片段一起缓存
- 缓存失败自动保留错误状态

## 使用限制

这是浏览器端离线缓存，视频数据存放在浏览器 IndexedDB 中。

播放源必须允许浏览器跨域读取 m3u8 和媒体分片（CORS）。动态直播 HLS / 没有 `#EXT-X-ENDLIST` 的播放源不会被缓存。

部分特殊 HLS 特性（例如复杂的 byte-range、DRM、FairPlay、特殊鉴权、需要动态 token 的源）可能无法离线使用。

浏览器本身有站点存储配额，超大视频缓存可能被浏览器拒绝。

## 主要新增文件

- `src/lib/offlineCache.client.ts`
- `src/app/cache/page.tsx`

并修改：

- `src/app/play/page.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MobileBottomNav.tsx`

没有新增 npm 依赖。
