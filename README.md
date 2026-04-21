# BatchRefiner

AI 图片批量生成与编辑工作台。

## 本地运行

前置条件：
- Node.js 22+

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

本地打开：

```text
http://localhost:3000
```

## API 使用方式

推荐方式：
- 在网页设置里填写 `API Base URL` 和 `API Key`
- 通过“导出加密配置”分享给别人
- 如果希望站点提供默认配置，可把导出的加密文件放到 `public/default-api-config.json`

说明：
- 加密配置文件适合分享和分发，但接收方仍然需要口令才能导入
- 纯前端页面无法把已解密的真实密钥做到绝对不可提取
- 不建议再把真实密钥直接写进 `VITE_` 环境变量并打包到前端

## Cloudflare Pages 部署

这个项目适合作为静态 Vite 站点部署到 Cloudflare Pages。

Pages 配置：
- Framework preset: `React (Vite)`
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

部署建议：
- 不要在 Cloudflare Pages 里设置真实的 `VITE_GEMINI_API_KEY`
- 如需预置配置，使用加密后的 `public/default-api-config.json`
- 部署后可让用户在网页内导入加密配置或自行填写 Key

## GitHub

仓库地址：

```text
https://github.com/Hill2048/BatchRefiner
```
