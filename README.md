# BatchRefiner

BatchRefiner 是一个面向图片批处理的工作台，支持：

- 批量导入原图并创建任务
- 生成任务级提示词
- 基于原图、参考图和全局参数批量出图
- 按任务管理多张批次结果图
- 保存、导入、导出项目快照

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

默认本地地址：

```text
http://localhost:3000
```

## 常用脚本

```bash
npm run lint
npm run build
npm test
```

## API 配置

推荐方式：

- 在页面配置区填写 `API Base URL` 和 `API Key`
- 通过导出项目或配置快照共享设置

说明：

- 前端页面无法彻底隐藏运行时使用的真实密钥
- 如果是公开部署，优先使用平台自己的密钥管理或中转服务
- 内置环境变量只适合受控环境，不适合把敏感密钥直接暴露到公网前端

## 项目核心流程

1. 导入图片，自动创建任务。
2. 按任务补充描述、参考图和专属参数。
3. 生成提示词或直接执行单任务 / 批量任务。
4. 在任务卡片内查看原图、结果图和批次结果。
5. 导出项目快照或导出结果图。

## 构建与部署

项目基于 Vite，可直接部署为静态站点。

推荐部署参数：

- Framework preset: `React (Vite)`
- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `main`

## 版本号规则

- 每次推送到 GitHub 前，`appVersion` 自动加 `0.1`
- 当前版本号集中写在 `package.json`

## 仓库地址

[https://github.com/Hill2048/BatchRefiner](https://github.com/Hill2048/BatchRefiner)
