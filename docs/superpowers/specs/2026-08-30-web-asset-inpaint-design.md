# Web 图片编辑：普通素材详情页 AI 局部重绘 (Inpaint) 设计

日期：2026-08-30
状态：已确认设计方案，待评审后进入实施计划

---

## 1. 背景与动机

在日常创作与素材整理中，普通素材图片（非已导出发布包）经常存在局部微瑕（如手部变形、表情欠佳、饰品遗漏等问题）。目前系统虽然在发布包详情中提供了马赛克涂抹（Manual Mosaic），但对于素材库（Library）中的原图，缺少直接基于 AI 进行局部重绘（Inpainting）并安全选优覆盖原图的能力。

本项目通过复用与借鉴 NovelAI Inpaint 官方协议（`tmp/novelai/`）以及 `vendor/ai-image-gateway` 的 Inpaint 架构，为 Library 素材大图详情弹窗（Lightbox）提供开箱即用的局部重绘工作台。

---

## 2. 目标与非目标

### 2.1 目标
1. **无缝集成于普通素材 Lightbox**：在素材详情页增加 `[🔍 查看详情]` 与 `[🖌️ 局部重绘 (Inpaint)]` 模式切换。
2. **精简高效的交互体验**：
   - 原图上层搭载 1:1 无损 Canvas 涂抹遮罩（Mask），支持画笔粗细调节（10~100px）、撤销（Ctrl+Z）、重做（Ctrl+Y）、清空遮罩。
   - 自动提取原图元数据（Prompt、Negative Prompt、Model、Steps、Scale、Sampler、Noise Schedule 等），右侧仅保留核心的提示词编辑、重绘去噪强度（Strength: 0.1~1.0）及生成张数（1张 / 2张 / 4张）。
   - 自动生成独立随机种子（Seed），无需用户繁琐配置。
3. **NovelAI 官方协议与鉴权**：
   - 支持自动读取本机已有的 `F:\my_project\new\tags_machine\novelai\client.py` Access Token、环境变量 `NAI_ACCESS_TOKEN` 或 workspace 配置。
   - 采用标准 `multipart/form-data`（`image` + `mask` + `request JSON`）协议构造 `action: "infill"` 请求，支持 NovelAI V3/V4/V4.5 Inpainting 模型。
4. **多候选对比与选择**：
   - 批量生成 `count` 张候选图并在右侧展示缩略卡片列表。
   - 提供**分屏滑动对比条（Split Slider）**与**快捷切换对比（Toggle）**，直观对比原图与重绘图交界。
5. **严格的原子安全覆盖**：
   - 只有在用户点击【✅ 确认采用并覆盖原图】后，才原子性替换原图源文件。
   - 自动重新解析覆盖后图片的元数据，更新 Catalog 中该资产的尺寸、大小、哈希、修改时间与 Prompt/Seed。
   - 放弃或关闭弹窗时自动清理临时生成文件，绝对不影响原图。

### 2.2 非目标
- 不引入外部庞大重量级模型推理依赖（全流程走远程 NovelAI API 接入）。
- 不破坏现有发布包导出的构建结构与 Catalog 分类结构。
- 不强制要求每次都生成 4 张图，支持按需单张极速生成。

---

## 3. 架构设计与模块分层

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Web 前端 (library.js / html)                       │
│  - Lightbox Inpaint Tab 切换                                                │
│  - Canvas 遮罩涂抹层 (1:1 坐标映射、画笔大小、撤销栈)                         │
│  - 提示词自动填充与重绘强度配置                                               │
│  - 候选图片网格与 Split Slider 对比视图                                     │
│  - 确认采用 / 放弃交互                                                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP REST API
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    Web API 路由层 (library_api.py)                          │
│  - POST /api/assets/{asset_id}/inpaint          (发起重绘任务)              │
│  - GET  /api/inpaint-cache/{session_id}/{id}.png (预览临时候选图)           │
│  - POST /api/assets/{asset_id}/inpaint/apply    (确认覆盖原图)              │
│  - DELETE /api/inpaint-cache/{session_id}       (放弃并清理临时图)           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                  核心服务层 (InpaintService & NovelAIClient)                 │
│  - 凭证解析器: 读取 client.py / 环境变量 / 配置                              │
│  - 遮罩预处理: ANR Grid (8x8 对齐) / 二值化 / 透明通道规范化                 │
│  - 请求组装器: multipart/form-data 组装 (action=infill, v4_prompt, etc.)    │
│  - 并发生成器: asyncio.gather 批量生成 count 张结果                         │
│  - 临时缓存池: workspace/tmp/inpaint/{session_id}                           │
│  - 原图原子覆盖: tempfile -> os.replace + CatalogRepository.update_asset    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 详细技术方案

### 4.1 NovelAI Token 鉴权与获取
在 `InpaintService` 中实现安全鉴权解析，按以下优先级获取 Token：
1. 本机 `F:\my_project\new\tags_machine\novelai\client.py` 中的 `NAIClient.get_access_token()`。
2. 环境变量 `NAI_ACCESS_TOKEN`。
3. `workspace.yaml` 中的 `novelai.access_token` 配置。

### 4.2 遮罩预处理与网络请求构造
- **遮罩网格对齐**：
  用户在前端 Canvas 涂抹的 Mask 导出为 PNG。后端接收后将其二值化，并做 8x8 ANR Grid 扩展（符合 NovelAI 官方规范），生成黑底白前景或透明通道 Mask。
- **请求格式**：
  使用 `httpx.AsyncClient` 构造 `POST https://image.novelai.net/ai/generate-image`：
  - Header: `Authorization: Bearer <access_token>`
  - Body: `multipart/form-data`
    - `image`: 原图 bytes (PNG)
    - `mask`: 遮罩 bytes (PNG)
    - `request`: JSON 字符串，包含 `input`, `model` (`{base_model}-inpainting`), `action: "infill"`, `parameters` (继承原图的 steps, scale, sampler, noise_schedule, seed=随机)。

### 4.3 前端工作台交互（Inpaint Tab）
- **UI 结构**：
  - Header 模式切换：`data-lb-tab="inpaint"`
  - 左侧工作区：
    - 涂抹模式：`inpaint-canvas-wrap`，包含背景原图 + 顶层半透明涂抹层。
    - 对比模式：`inpaint-compare-wrap`，支持 Split Slider 对比滑块，拖拽滑块实时查看原图与重绘图左右分割对比。
  - 右侧控制栏：
    - `Prompt`：多行文本框（自动填充原图 prompt）。
    - `Negative Prompt`：多行文本框（自动填充原图 uc）。
    - `Strength`：滑块 `0.10 ~ 1.00`，默认 `0.70`。
    - `Count`：`1 / 2 / 4` 单选按钮组，默认 `2`。
    - `[ 🚀 开始局部重绘 ]` 按钮。
    - 候选图片卡片列表：生成成功后展示缩略图，点击可在左侧对比。
    - `[ ✅ 确认采用并覆盖原图 ]` 与 `[ ❌ 放弃 ]` 按钮。

### 4.4 原子覆盖与 Catalog 元数据刷新
当用户确认采用时：
1. 将选中的候选图写入 `asset.path.with_suffix('.tmp')`。
2. 校验文件有效性后，调用 `os.replace` 原子性替换 `asset.path`。
3. 重新提取图片尺寸、文件大小、SHA256 哈希、修改时间以及生成元数据。
4. 调用 `CatalogRepository` 更新资产记录，并触发时间戳版本号递增。
5. 清除该会话的临时文件。
6. 前端更新当前 Lightbox 的图片与元数据，并更新瀑布流缩略图。

---

## 5. API 接口定义

### 5.1 `POST /api/assets/{asset_id}/inpaint`
- **请求类型**：`multipart/form-data`
- **请求字段**：
  - `mask`: File (PNG 图片，包含涂抹区域)
  - `prompt`: str (用户调整后的正向提示词)
  - `negative_prompt`: str (用户调整后的负向提示词)
  - `strength`: float (重绘去噪强度，如 0.7)
  - `count`: int (生成张数，1~4，默认 2)
- **响应**：
  ```json
  {
    "success": true,
    "session_id": "inp_20260830_a1b2c3d4",
    "candidates": [
      {
        "candidate_id": "cand_0",
        "preview_url": "/api/inpaint-cache/inp_20260830_a1b2c3d4/cand_0.png",
        "seed": 1827391823,
        "width": 832,
        "height": 1216
      },
      {
        "candidate_id": "cand_1",
        "preview_url": "/api/inpaint-cache/inp_20260830_a1b2c3d4/cand_1.png",
        "seed": 1827391824,
        "width": 832,
        "height": 1216
      }
    ]
  }
  ```

### 5.2 `GET /api/inpaint-cache/{session_id}/{filename}`
- **响应**：临时生成的候选图片二进制文件（支持前端即时预览）。

### 5.3 `POST /api/assets/{asset_id}/inpaint/apply`
- **请求类型**：`application/json`
- **请求体**：
  ```json
  {
    "session_id": "inp_20260830_a1b2c3d4",
    "candidate_id": "cand_0"
  }
  ```
- **响应**：
  ```json
  {
    "success": true,
    "asset_id": "ast_xxxx",
    "new_size_bytes": 1420583,
    "mtime": 1788021000
  }
  ```

### 5.4 `DELETE /api/inpaint-cache/{session_id}`
- **响应**：`{"success": true}`，清理临时缓存。

---

## 6. 测试与验证计划

1. **单元与集成测试**：
   - 遮罩处理与网格扩展测试（验证 8x8 ANR 对齐）。
   - Inpaint 请求组装测试（验证 multipart 格式与参数继承）。
   - Mock Inpaint Provider 测试（验证生成多张图片与临时缓存）。
   - Apply 接口测试（验证原图原子覆盖、临时文件清理以及 Catalog 更新）。
2. **端到端浏览器交互测试**：
   - 打开 Library 页面并点击任意素材打开 Lightbox。
   - 切换到 `🖌️ 局部重绘 (Inpaint)` 页签，验证 Prompt/Negative Prompt 自动继承。
   - 在 Canvas 上涂抹遮罩，调整画笔大小，测试撤销/重做。
   - 选择生成 2 张并点击生成，验证候选列表渲染与 Split Slider 对比。
   - 点击确认覆盖，验证原图成功替换且页面缩略图自动刷新。
