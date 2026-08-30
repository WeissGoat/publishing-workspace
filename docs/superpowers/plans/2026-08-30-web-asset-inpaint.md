# Web 图片编辑：普通素材详情页 AI 局部重绘 (Inpaint) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在素材库（Library）普通素材图片详情页（Lightbox）中新增 `[🖌️ 局部重绘 (Inpaint)]` 页签，支持 1:1 像素遮罩涂抹、自动继承原图元数据与提示词微调、基于 NovelAI 协议批量生成候选图、Split Slider 滑块对比以及原子安全覆盖原图。

**Architecture:** 
1. 后端：解耦的 `publishing_workspace.inpaint` 模块，包含 `NovelAIClient`（Token 鉴权、8x8 ANR 遮罩扩展、HAR 协议对齐的 multipart 请求组装）和 `InpaintService`（并发生成候选图、临时缓存管理、原图原子覆盖与 Catalog 更新）。
2. Web API：在 `library_api.py` 中暴露 `/api/assets/{asset_id}/inpaint`、`/api/inpaint-cache/...`、`/api/assets/{asset_id}/inpaint/apply` 路由。
3. 前端：在 `library.html` / `library.css` / `library.js` 中集成 Inpaint 遮罩画板、精简参数面板、候选图列表、Split Slider 分屏对比组件以及覆盖/放弃交互逻辑。

**Tech Stack:** Python 3.11, FastAPI, Pillow, NumPy, httpx, HTML5 Canvas, Vanilla JS (ES6+), CSS3 Grid/Flexbox.

**Spec:** [`docs/superpowers/specs/2026-08-30-web-asset-inpaint-design.md`](file:///f:/my_project/new/tags_machine/refactor/tools/publishing_workspace/docs/superpowers/specs/2026-08-30-web-asset-inpaint-design.md)

## Global Constraints

- **协议对齐**：请求参数与结构必须 100% 严格比对并对齐 `tmp/novelai/novelai.net.har` 中的 NovelAI 官方 Inpaint 请求（`action: "infill"`、`model: "{model}-inpainting"`、`params_version: 4`、`inpaintImg2ImgStrength: 1.0` 等）。
- **Token 自动获取**：优先从 `F:\my_project\new\tags_machine\novelai\client.py` 解析 Token，备选环境变量 `NAI_ACCESS_TOKEN` 与配置文件。
- **安全覆盖门禁**：仅在用户明确点击【✅ 确认采用并覆盖原图】后才使用 `os.replace` 原子覆盖，放弃时自动清理临时文件，原图保持不变。
- **Catalog 同步**：覆盖后必须同步更新 Catalog 数据库与快照中的资产元数据（尺寸、哈希、时间戳、Prompt/Seed）。

---

### Task 1: Inpaint 核心协议与服务层实现 (`publishing_workspace.inpaint`)

**Files:**
- Create: `src/publishing_workspace/inpaint/models.py`
- Create: `src/publishing_workspace/inpaint/mask.py`
- Create: `src/publishing_workspace/inpaint/client.py`
- Create: `src/publishing_workspace/inpaint/service.py`
- Create: `src/publishing_workspace/inpaint/__init__.py`
- Test: `tests/test_inpaint_service.py`

**Interfaces:**
- Consumes: `publishing_workspace.config.load_workspace`, `publishing_workspace.catalog.repository.CatalogRepository`
- Produces: `InpaintService.generate(paths, asset_id, mask_bytes, prompt, negative_prompt, strength, count)` -> `InpaintSessionResult`, `InpaintService.apply_candidate(paths, asset_id, session_id, candidate_id)` -> `AssetRecord`

- [ ] **Step 1: 编写测试用例 `tests/test_inpaint_service.py`**

```python
from pathlib import Path
import io
import pytest
from PIL import Image
from publishing_workspace.inpaint.mask import expand_binary_mask_to_anr_grid, mask_to_novelai_png_bytes
from publishing_workspace.inpaint.client import NovelAIInpaintClient, resolve_novelai_token
from publishing_workspace.inpaint.service import InpaintService

def test_mask_anr_grid_expansion():
    # 创建 64x64 黑底，并在中间 (16,16) 绘制 8x8 白色方块
    img = Image.new("L", (64, 64), 0)
    for x in range(16, 24):
        for y in range(16, 24):
            img.putpixel((x, y), 255)
    
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    mask_bytes = buf.getvalue()
    
    processed_bytes = mask_to_novelai_png_bytes(mask_bytes, (64, 64), is_v4=True)
    assert len(processed_bytes) > 0
    with Image.open(io.BytesIO(processed_bytes)) as out_img:
        assert out_img.size == (64, 64)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `uv run pytest tests/test_inpaint_service.py`
Expected: FAIL (ModuleNotFoundError: publishing_workspace.inpaint)

- [ ] **Step 3: 实现 `models.py`、`mask.py`、`client.py`、`service.py`**
  - `mask.py`：实现 8x8 ANR Grid 扩展与 Mask 格式转换。
  - `client.py`：实现 Token 自动解析（读取 client.py / 环境变量）、HAR 协议匹配的 multipart 请求构建与异步调用。
  - `service.py`：继承原图 PNG 元数据、并发生成并写入 `workspace/tmp/inpaint/{session_id}`。

- [ ] **Step 4: 运行测试验证通过**

Run: `uv run pytest tests/test_inpaint_service.py`
Expected: PASS

---

### Task 2: Web API 局部重绘端点实现与测试

**Files:**
- Modify: `src/publishing_workspace/web/library_api.py`
- Test: `tests/test_library_inpaint_api.py`

**Interfaces:**
- Consumes: `InpaintService`
- Produces: 
  - `POST /api/assets/{asset_id}/inpaint`
  - `GET /api/inpaint-cache/{session_id}/{filename}`
  - `POST /api/assets/{asset_id}/inpaint/apply`
  - `DELETE /api/inpaint-cache/{session_id}`

- [ ] **Step 1: 编写 API 集成测试 `tests/test_library_inpaint_api.py`**
  - 测试发起重绘任务、缓存读取、候选图片原子覆盖原图与 Catalog 同步、放弃清理缓存。

- [ ] **Step 2: 运行测试验证失败**

Run: `uv run pytest tests/test_library_inpaint_api.py`
Expected: FAIL (404 Not Found)

- [ ] **Step 3: 在 `library_api.py` 中注册 Inpaint 路由**
  - 注册 `POST /api/assets/{asset_id}/inpaint`、`GET /api/inpaint-cache/{session_id}/{filename}`、`POST /api/assets/{asset_id}/inpaint/apply`、`DELETE /api/inpaint-cache/{session_id}`。

- [ ] **Step 4: 运行测试验证通过**

Run: `uv run pytest tests/test_library_inpaint_api.py`
Expected: PASS

---

### Task 3: 前端 UI 布局与样式扩展 (`library.html` & `library.css`)

**Files:**
- Modify: `src/publishing_workspace/web/static/library.html`
- Modify: `src/publishing_workspace/web/static/library.css`

**UI Components:**
- Lightbox Header 页签：`[🔍 查看详情]` 与 `[🖌️ 局部重绘 (Inpaint)]`（在普通图片和构建图片模式下均自适应）。
- 左侧工作区：
  - `inpaint-canvas-wrap`：遮罩绘制 Canvas 与光标 Canvas。
  - `inpaint-compare-wrap`：Split Slider 对比器（原图层、重绘图层、拖拽把手 handle）。
- 右侧控制区 (`lightbox-inpaint-sidebar`)：
  - Prompt 多行文本框、Negative Prompt 多行文本框。
  - Strength 滑块 (0.1 ~ 1.0, 默认 0.70)。
  - Count 单选组 (`[ 1张 ] [ 2张 (默认) ] [ 4张 ]`)。
  - `[ 🚀 开始局部重绘 ]` 按钮及加载状态。
  - 候选卡片列表、对比切换按钮。
  - `[ ✅ 确认采用并覆盖原图 ]` 与 `[ ❌ 放弃 ]` 操作栏。

- [ ] **Step 1: 更新 `library.html` 添加 Inpaint 结构**
- [ ] **Step 2: 更新 `library.css` 添加 Inpaint 画板、Split Slider 对比条与精简侧栏样式**

---

### Task 4: 前端交互与工作流实现 (`library.js`)

**Files:**
- Modify: `src/publishing_workspace/web/static/library.js`

**Workflow Steps:**
- [ ] **Step 1: 模式切换与元数据自动预填**
  - 在 `switchLightboxMode("inpaint")` 时，从已加载的 asset details 中提取 `prompt`、`negative_prompt`，自动填充到右侧输入框。
  - 1:1 适配并加载原图至 `inpaint-canvas`。
- [ ] **Step 2: 遮罩涂抹与历史栈管理**
  - 支持画笔大小调节（10~100px）、鼠标涂抹、半透明遮罩高亮渲染。
  - 支持 `Ctrl+Z` 撤销、`Ctrl+Y` 重做、清空遮罩。
- [ ] **Step 3: 发起重绘与候选列表渲染**
  - 点击【🚀 开始局部重绘】：将 Canvas 导出为 PNG Blob，携带 prompt、negative_prompt、strength、count POST 发送到 `/api/assets/{asset_id}/inpaint`。
  - 收到返回结果后，渲染右侧候选缩略图列表，默认激活第 1 张。
- [ ] **Step 4: Split Slider 与按住对比交互**
  - 左侧切换至 `inpaint-compare-wrap`，设置原图与重绘图。
  - 绑定鼠标/触摸拖拽事件，实时调整对比分割线。
  - 提供“按住查看原图”快捷按钮。
- [ ] **Step 5: 确认覆盖与放弃清理**
  - 点击【✅ 确认采用并覆盖原图】：调用 `/api/assets/{asset_id}/inpaint/apply`，成功后提示通知，用带时间戳 URL 刷新当前大图与 Library 瀑布流缩略图，切回 `view` 模式。
  - 点击【❌ 放弃】：调用 DELETE `/api/inpaint-cache/{session_id}`，清空遮罩并恢复原状。

---

### Task 5: NovelAI HAR 协议参数严格比对测试与全量交付验证

**Files:**
- Create: `tests/test_inpaint_har_parity.py`
- Test: `uv run pytest -q`

- [ ] **Step 1: 编写 HAR 协议参数字段完全一致性比对测试**
  - 读取 `tmp/novelai/novelai.net.har` 中真实的 inpaint 请求 JSON 与 multipart 格式。
  - 与 `publishing_workspace.inpaint.client` 构建的 payload 进行逐字段验证：
    - `model.endswith("-inpainting")`
    - `action == "infill"`
    - `parameters["params_version"] == 4`
    - `parameters["inpaintImg2ImgStrength"] == 1.0`
    - `parameters["strength"] == 0.7`
    - `parameters["noise_schedule"] == "karras"`
    - `v4_prompt` 格式与结构完全一致。
- [ ] **Step 2: 运行 HAR 参数比对测试并验证 100% 通过**
- [ ] **Step 3: 运行全量测试套件 `uv run pytest -q` 确保所有 212+ 项测试通过**
- [ ] **Step 4: 运行独立服务验证真实 E2E 交互与前后端日志闭环**

---

## Execution Handoff

实施计划已就绪并保存至：
[`docs/superpowers/plans/2026-08-30-web-asset-inpaint.md`](file:///f:/my_project/new/tags_machine/refactor/tools/publishing_workspace/docs/superpowers/plans/2026-08-30-web-asset-inpaint.md)

请选择执行方式：
1. **Subagent-Driven (推荐)**：每个 Task 分发独立子代理实施并进行阶段性 Review。
2. **Inline Execution**：在当前会话中按步骤逐项执行实施计划。

你想采用哪种方式开始执行？
