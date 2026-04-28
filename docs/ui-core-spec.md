# 网页核心 UI 规格

## 1. 说明

这份文档只记录当前项目里最核心、使用最多、最能决定整体风格的 UI 细节。

不写长尾样式，不写单次出现的小特例，优先记录：

- 全局主色
- 常用中性色
- 圆角体系
- 描边粗细
- 阴影层级
- 字体体系
- 主要模块的统一外观

## 2. 全局风格一句话

整体是“暖米白底 + 白色卡片 + 橘棕主按钮 + 深灰文字 + 轻描边 + 大圆角”的柔和工作台风格。

## 3. 核心色值

### 3.1 主色

- 主按钮色：`#D97757`
  用途：主按钮、激活态、高亮描边、焦点 ring、选中态强调

### 3.2 背景色

- 页面总背景：`#F9F8F6`
  用途：整页底色、侧栏底色、弹窗大底

- 卡片白底：`#FFFFFF`
  用途：工作区、任务卡、输入框、弹层、下拉、弹窗内部卡片

- 浅灰米底：`#F5F4F0`
  用途：次级按钮底、浅层面板底、编辑器外层底、占位块底

- 次级浅底：`#F0EFEA`
  用途：secondary / muted / accent 体系的统一浅底

- 禁用/填充浅灰：`#E8E5DF`
  用途：禁用按钮底、进度条轨道、弱交互背景

### 3.3 文字色

- 主文字：`#1A1918`
  用途：标题、正文、主要按钮文字、核心信息

- 次文字：`#6B6965`
  用途：说明文案、标签、副信息、弱按钮文字

### 3.4 描边色

- 主描边：`#EAE9E5`
  用途：全局输入框、卡片边线、分割线、弹层边线

### 3.5 补充状态色

这组不是全站主色，但在状态场景里反复出现：

- 成功绿：`#2D734C`
- 警告黄棕：`#B97512`
- 错误红：`#BE3827`

## 4. 字体体系

### 4.1 正文字体

- 主无衬线：`Inter`
- 回退：`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif`

### 4.2 标题字体

- 主衬线：`Source Serif 4`
- 回退：`Georgia, Cambria, Times New Roman, serif`

### 4.3 默认字号

- 页面基础字号：`14.7px`
- 常用标签/辅助文案：`10.5px / 11.55px / 12.6px`
- 常用输入/正文：`13.65px ~ 15.44px`
- 常用模块标题：`18.9px`
- 大弹窗标题：`22px`

## 5. 圆角体系

项目当前圆角基准值：

- 基础圆角：`12px`

由此延伸出的核心圆角：

- `rounded-lg`：约 `12px`
- `rounded-xl`：约 `16.8px`
- `rounded-2xl`：约 `21.6px`
- `rounded-3xl`：约 `26.4px`
- `rounded-[24px]`：任务卡激活态、设置弹窗
- `rounded-[28px]`：大编辑器、沉浸式预览类大容器
- `rounded-full`：胶囊标签、状态条、小悬浮操作

### 5.1 最常用圆角

按出现频率看，最核心的是：

- `rounded-full`
- `rounded-xl`
- `rounded-lg`
- `rounded-2xl`

可以理解为：

- 小控件：`lg`
- 表单卡 / 输入块：`xl`
- 主卡片 / 面板：`2xl`
- 胶囊 / 标签 / 状态：`full`

## 6. 描边与线条

### 6.1 默认描边

- 默认描边厚度：`1px`
- 默认描边颜色：`#EAE9E5`

这是全站最常见的边线标准。

### 6.2 常见描边透明度

项目里大量使用半透明边线，最常见的是：

- `border-black/6`
- `border-black/8`
- `border-black/10`
- `border-border/60`
- `border-border/70`
- `border-border/80`

简单理解：

- 白卡内部精细边线：偏 `black/6` 到 `black/10`
- 结构边线和表单边线：偏 `border-border`

### 6.3 特殊描边

- 拖拽态 / 导入态：`2px dashed`
- 焦点态：主色边 + ring

## 7. 阴影体系

### 7.1 全局主面板阴影

- `0 12px 40px -8px rgba(0,0,0,0.04), 0 4px 12px -2px rgba(0,0,0,0.02)`

用途：

- 主工作区外框
- 大型白色内容区域

### 7.2 常用卡片阴影

- `shadow-sm`
- `0 2px 8px rgba(0,0,0,0.06)`
- `0 8px 30px rgba(0,0,0,0.08)`

用途：

- 小按钮
- 下拉选中块
- 普通卡片 hover

### 7.3 大弹层阴影

- `0 12px 40px -5px rgba(0,0,0,0.12)`
- `0 18px 44px -12px rgba(0,0,0,0.18)`
- `0 24px 80px -24px rgba(0,0,0,0.35)`

用途：

- 设置弹窗
- Popover
- 大编辑器弹窗

## 8. 交互高亮规则

### 8.1 激活态

- 背景优先用主色：`#D97757`
- 文字用白色：`#FFFFFF`
- 辅助可叠加轻阴影

### 8.2 Hover 态

最常用 hover 背景不是大面积换色，而是：

- `bg-black/5`
- 或白底轻微提亮

### 8.3 焦点态

最常用规则：

- 边框切到主色或主色透明态
- ring 使用主色透明层

常见厚度：

- `ring-2`
- `ring-3`

## 9. 主要模块规格

## 9.1 页面骨架

### 整页

- 背景：`#F9F8F6`
- 文字：`#1A1918`
- 主体基调：暖白、轻阴影、低对比

### 主工作区

- 背景：白色
- 外框：`1px` 边线，偏 `border-border/40`
- 圆角：`rounded-2xl` 或 `22px`
- 阴影：使用全局主面板阴影

## 9.2 Topbar 顶栏

- 背景：跟随页面背景 `#F9F8F6`
- 标题字体：`Source Serif 4`
- 项目切换弹层：白底 + `rounded-2xl` + `1px` 描边 + 中等阴影
- 顶栏按钮：白底弱透明或 ghost 风格，hover 用 `bg-black/5`

## 9.3 Sidebar 侧栏

- 背景：跟随页面背景
- 主要输入块：白卡 / `rounded-2xl`
- 次级操作按钮：`#F5F4F0`
- 主操作区底座：深色块 `#2C2B29`
- 执行主按钮：深底白字，危险停止态转红

侧栏的核心视觉是：

- 米白底
- 白卡输入块
- 浅灰按钮
- 底部深色执行条

## 9.4 Task Card 任务卡

### 收起态

- 背景：白色
- 描边：`1px border-black/8`
- 圆角：`rounded-2xl`
- 阴影：默认 `shadow-sm`，hover 增强

### 激活态

- 背景：白色
- 圆角：`24px`
- 阴影更重
- 可带主色 ring 作为文件拖入高亮

### 卡内次级内容块

- 常用浅底：`#FCFBF8`
- 内部正文框：白底 + 轻描边 + `14px` 左右圆角

## 9.5 Settings Dialog 设置弹窗

- 外层底：`#F9F8F6`
- 内部卡片：白色
- 圆角：外层 `24px`，内部表单块 `12px ~ 16.8px`
- 边线：`1px border-border`
- 操作按钮：白色胶囊小按钮 + 主色保存按钮

这是典型的：

- 外层暖底
- 内层白卡
- 标题衬线
- 小按钮轻阴影

## 9.6 Popover / Dropdown / 小弹层

- 背景：白色
- 圆角：`rounded-xl` 到 `rounded-2xl`
- 描边：`1px`
- 阴影：中等浮层阴影
- 选中项：主色淡底或浅灰 hover 底

## 9.7 表单控件

### 输入框

- 高度常用：`32px` 或 `44px`
- 背景：透明或白色
- 描边：`1px border-input`
- 圆角：默认 `rounded-lg`
- 焦点：主色描边 + `ring-3`

### 按钮

最常用有三类：

- 主按钮：主色底 + 白字
- 次按钮：白底 + 灰描边
- ghost 按钮：透明底，hover 轻灰

默认按钮特征：

- 字重：`500`
- 圆角：`lg` 为主，小按钮常见 `md`
- 描边：默认 `1px`

## 10. 模块级使用建议

如果后面继续加新模块，优先沿用下面这组组合：

- 页面底：`#F9F8F6`
- 卡片底：`#FFFFFF`
- 次级浅底：`#F5F4F0`
- 主描边：`#EAE9E5`
- 主文字：`#1A1918`
- 次文字：`#6B6965`
- 强调色：`#D97757`
- 主卡圆角：`rounded-2xl`
- 表单圆角：`rounded-xl`
- 小控件圆角：`rounded-lg`
- 默认描边：`1px`

## 11. 不建议偏离的点

- 不建议把主色改成冷色或紫色
- 不建议把页面大底改成纯白
- 不建议把卡片圆角突然收窄成锐利直角
- 不建议把 hover 做成重色块闪烁
- 不建议让不同模块各自发明不同的边线灰度

## 12. 关联文件

- [src/index.css](F:/AI%20HOME/CODEX/%E6%89%B9%E9%87%8F%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E6%9E%B6%E6%9E%84%E6%94%B9%E9%80%A0%E5%A4%87%E4%BB%BD-20260423-165902/src/index.css)
- [src/App.tsx](F:/AI%20HOME/CODEX/%E6%89%B9%E9%87%8F%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E6%9E%B6%E6%9E%84%E6%94%B9%E9%80%A0%E5%A4%87%E4%BB%BD-20260423-165902/src/App.tsx)
- [src/components/layout/Topbar.tsx](F:/AI%20HOME/CODEX/%E6%89%B9%E9%87%8F%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E6%9E%B6%E6%9E%84%E6%94%B9%E9%80%A0%E5%A4%87%E4%BB%BD-20260423-165902/src/components/layout/Topbar.tsx)
- [src/components/layout/Sidebar.tsx](F:/AI%20HOME/CODEX/%E6%89%B9%E9%87%8F%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E6%9E%B6%E6%9E%84%E6%94%B9%E9%80%A0%E5%A4%87%E4%BB%BD-20260423-165902/src/components/layout/Sidebar.tsx)
- [src/components/workspace/TaskCard.tsx](F:/AI%20HOME/CODEX/%E6%89%B9%E9%87%8F%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E6%9E%B6%E6%9E%84%E6%94%B9%E9%80%A0%E5%A4%87%E4%BB%BD-20260423-165902/src/components/workspace/TaskCard.tsx)
- [src/components/SettingsDialog.tsx](F:/AI%20HOME/CODEX/%E6%89%B9%E9%87%8F%E5%B7%A5%E4%BD%9C%E5%8F%B0-%E6%9E%B6%E6%9E%84%E6%94%B9%E9%80%A0%E5%A4%87%E4%BB%BD-20260423-165902/src/components/SettingsDialog.tsx)
