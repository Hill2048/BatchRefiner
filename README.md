# BatchRefiner

AI 图片批量处理工作台。

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

可选方式：
- 本地 `.env.local` 中配置 `VITE_GEMINI_API_KEY`

示例：

```env
VITE_GEMINI_API_KEY=your_local_gemini_key
```

注意：
- `VITE_` 前缀变量会被打进前端构建产物
- 只适合本地开发或你明确接受密钥暴露的场景
- 公网部署时不要把真实密钥直接放进前端

## Cloudflare Pages 部署

这个项目适合按静态 Vite 站点部署到 Cloudflare Pages。

Pages 配置：
- Framework preset: `React (Vite)`
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

部署步骤：
1. 打开 Cloudflare Dashboard
2. 进入 `Workers & Pages`
3. 选择 `Create application`
4. 选择 `Pages`
5. 连接 GitHub 仓库 `Hill2048/BatchRefiner`
6. 填入上面的构建配置
7. 点击 `Save and Deploy`

生产环境建议：
- 不要在 Cloudflare Pages 里设置 `VITE_GEMINI_API_KEY`
- 部署后通过网页内设置让用户自己填写 API Key

## GitHub

仓库地址：

```text
https://github.com/Hill2048/BatchRefiner
```
