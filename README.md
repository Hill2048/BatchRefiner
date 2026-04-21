# BatchRefiner

AI 批量图片生成与编辑工作台。

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

本地地址：
```text
http://localhost:3000
```

## API 配置

推荐方式：
- 在网页设置里填写 `API Base URL` 和 `API Key`
- 通过“导出配置”分享配置文件

说明：
- 导出的配置文件不会直接暴露明文 `API Key`
- 这只是提高提取门槛，不是绝对不可破解
- 纯前端页面无法彻底隐藏运行时真实密钥

## 部署

适合作为静态 Vite 站点部署到 Cloudflare Pages。

Pages 配置：
- Framework preset: `React (Vite)`
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

## GitHub

仓库地址：
```text
https://github.com/Hill2048/BatchRefiner
```
