"""Auto Mosaic Pipeline 测试与多参数/多强度对比脚本。

支持输入单张图片，调用 YOLO / YOLO+SAM 检测器生成遮罩，
并按指定的强度列表（Pixel Size、Blur Radius 等）批量生成打码结果，
同时自动合成多图对比大图 (comparison_grid.png) 与交互式可视化对比网页 (comparison.html)。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import webbrowser
from pathlib import Path
from typing import Any, List, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFont, ImageOps

# 尝试导入工程内部模块
try:
    from publishing_workspace.integrations.anr_mosaic.detector import (
        YoloDetector,
        YoloSamDetector,
        _write_empty_mask,
    )
    from publishing_workspace.integrations.anr_mosaic.mosaics import ImageMosaicProcessor
    from publishing_workspace.integrations.anr_mosaic.settings import (
        DETECTOR_LABELS,
        MosaicSettings,
    )
except ImportError:
    # 允许从任意路径直接执行脚本
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from publishing_workspace.integrations.anr_mosaic.detector import (
        YoloDetector,
        YoloSamDetector,
        _write_empty_mask,
    )
    from publishing_workspace.integrations.anr_mosaic.mosaics import ImageMosaicProcessor
    from publishing_workspace.integrations.anr_mosaic.settings import (
        DETECTOR_LABELS,
        MosaicSettings,
    )


def find_default_model_dir(custom_path: str | Path | None = None) -> Path | None:
    """自动查找 YOLO 和 SAM 模型的根目录。"""
    candidates: list[Path] = []
    if custom_path:
        candidates.append(Path(custom_path).expanduser().resolve())

    # 当前工作目录与工程目录下的常见位置
    script_dir = Path(__file__).resolve().parent
    workspace_root = script_dir.parent
    candidates.extend(
        [
            workspace_root / "models" / "anr_plugin_auto_mosaics",
            workspace_root / "models",
            Path("G:/ai_publish/models/anr_plugin_auto_mosaics"),
            Path("G:/ai_publish/models"),
            Path("./models/anr_plugin_auto_mosaics"),
            Path("./models"),
        ]
    )

    for c in candidates:
        if c.is_dir():
            yolo_file = c / "yolo" / "censor.pt"
            if yolo_file.is_file():
                return c
            # 或者直接在根目录下
            if (c / "censor.pt").is_file():
                return c
    return candidates[0] if candidates else None


def locate_model_files(model_dir: Path) -> tuple[Path | None, Path | None]:
    """定位 censor.pt 和 sam_vit_b_01ec64.pth 文件路径。"""
    yolo_candidates = [
        model_dir / "yolo" / "censor.pt",
        model_dir / "censor.pt",
    ]
    sam_candidates = [
        model_dir / "sams" / "sam_vit_b_01ec64.pth",
        model_dir / "sam_vit_b_01ec64.pth",
        model_dir / "sam" / "sam_vit_b_01ec64.pth",
    ]

    yolo_path = next((p for p in yolo_candidates if p.is_file()), None)
    sam_path = next((p for p in sam_candidates if p.is_file()), None)
    return yolo_path, sam_path


def create_mask_overlay(source_img: Image.Image, mask_img: Image.Image) -> Image.Image:
    """生成带半透明红色高亮遮罩的原图覆盖预览，方便直观核对检测部位。"""
    src = source_img.convert("RGBA")
    mask = mask_img.convert("L")
    if mask.size != src.size:
        mask = mask.resize(src.size, Image.Resampling.NEAREST)

    # 红色半透明高亮层
    overlay = Image.new("RGBA", src.size, (255, 30, 80, 140))
    result = Image.composite(overlay, src, mask)
    return result.convert("RGB")


def render_label_header(
    img: Image.Image,
    title: str,
    subtitle: str = "",
    header_height: int = 40,
) -> Image.Image:
    """在图片上方绘制醒目的信息标题横条。"""
    w, h = img.size
    canvas = Image.new("RGB", (w, h + header_height), (24, 28, 36))
    canvas.paste(img, (0, header_height))
    draw = ImageDraw.Draw(canvas)

    # 绘制标题文字
    text = title if not subtitle else f"{title} ({subtitle})"
    draw.text((12, int(header_height / 2) - 7), text, fill=(255, 255, 255))
    return canvas


def generate_comparison_grid(
    items: list[tuple[str, str, Path]],
    output_path: Path,
    max_cols: int = 4,
    thumb_width: int = 480,
) -> None:
    """将所有测试结果和原图合成为单张多列网格对比大图。"""
    if not items:
        return

    # 加载并缩放缩略图
    cards: list[Image.Image] = []
    for title, subtitle, img_path in items:
        if not img_path.is_file():
            continue
        try:
            with Image.open(img_path) as raw_img:
                raw_rgb = raw_img.convert("RGB")
                orig_w, orig_h = raw_rgb.size
                scale = thumb_width / orig_w
                target_h = int(orig_h * scale)
                thumb = raw_rgb.resize((thumb_width, target_h), Image.Resampling.LANCZOS)
                card = render_label_header(thumb, title, subtitle, header_height=36)
                cards.append(card)
        except Exception as e:
            print(f"[Warning] 无法加载图片生成网格 {img_path}: {e}")

    if not cards:
        return

    cols = min(max_cols, len(cards))
    rows = (len(cards) + cols - 1) // cols

    card_w = thumb_width
    card_h = max(c.height for c in cards)

    gap = 16
    padding = 20
    grid_w = padding * 2 + cols * card_w + (cols - 1) * gap
    grid_h = padding * 2 + rows * card_h + (rows - 1) * gap

    grid_img = Image.new("RGB", (grid_w, grid_h), (15, 18, 24))

    for idx, card in enumerate(cards):
        r = idx // cols
        c = idx % cols
        x = padding + c * (card_w + gap)
        y = padding + r * (card_h + gap)
        grid_img.paste(card, (x, y))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    grid_img.save(output_path, quality=92)
    print(f"[Grid] 已生成多图对比全景大图: {output_path}")


def generate_comparison_html(
    image_name: str,
    original_rel: str,
    mask_rel: str,
    overlay_rel: str,
    results: list[dict[str, Any]],
    output_path: Path,
    stats: dict[str, Any],
) -> None:
    """生成带有交互式 Before/After 滑块与多视图切换的对比报告网页。"""
    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto Mosaic 效果对比评估 - {image_name}</title>
  <style>
    :root {{
      --bg: #0f172a;
      --card-bg: #1e293b;
      --accent: #0ea5e9;
      --accent-hover: #38bdf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      line-height: 1.5;
    }}
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }}
    .title-group h1 {{ font-size: 22px; font-weight: 700; color: #fff; }}
    .title-group p {{ font-size: 13px; color: var(--text-muted); margin-top: 4px; }}
    .meta-badges {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    .badge {{
      background: #334155;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      color: #e2e8f0;
    }}
    .badge.highlight {{ background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid #0284c7; }}

    /* 视图切换 Tabs */
    .view-tabs {{
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      background: var(--card-bg);
      padding: 4px;
      border-radius: 8px;
      width: fit-content;
      border: 1px solid var(--border);
    }}
    .tab-btn {{
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s;
    }}
    .tab-btn.active {{
      background: var(--accent);
      color: #fff;
    }}

    /* 网格视图 */
    .gallery-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }}
    .card {{
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: transform 0.15s, box-shadow 0.15s;
    }}
    .card:hover {{
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      border-color: var(--accent);
    }}
    .card-header {{
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }}
    .card-title {{ font-size: 13.5px; font-weight: 600; color: #fff; }}
    .card-tag {{
      font-size: 11px;
      background: #0284c7;
      color: #fff;
      padding: 2px 6px;
      border-radius: 4px;
    }}
    .card-img-wrap {{
      position: relative;
      background: #000;
      width: 100%;
      cursor: zoom-in;
    }}
    .card-img-wrap img {{
      display: block;
      width: 100%;
      height: auto;
      object-fit: contain;
    }}

    /* 卷帘对比视图 (Slider View) */
    .slider-view {{
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      max-width: 1000px;
      margin: 0 auto;
    }}
    .slider-controls {{
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      background: var(--card-bg);
      padding: 10px 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      width: 100%;
    }}
    .slider-label {{ font-size: 13px; color: var(--text-muted); }}
    .slider-pills {{ display: flex; gap: 6px; flex-wrap: wrap; }}
    .pill-btn {{
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid var(--border);
      background: #334155;
      color: #f8fafc;
      border-radius: 4px;
      cursor: pointer;
    }}
    .pill-btn.active {{
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-weight: 600;
    }}
    .split-compare-container {{
      position: relative;
      width: 100%;
      max-height: 80vh;
      overflow: hidden;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #000;
      user-select: none;
    }}
    .split-image {{
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
    }}
    .split-overlay {{
      position: absolute;
      top: 0;
      left: 0;
      width: 50%;
      height: 100%;
      overflow: hidden;
      border-right: 2px solid var(--accent);
    }}
    .split-overlay img {{
      position: absolute;
      top: 0;
      left: 0;
      width: 1000px; /* dynamically matched in JS */
      height: auto;
      max-width: none;
    }}
    .split-divider {{
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 4px;
      background: var(--accent);
      cursor: ew-resize;
      transform: translateX(-50%);
    }}
    .split-handle {{
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--accent);
      border: 3px solid #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #fff;
    }}
    .split-badge {{
      position: absolute;
      top: 12px;
      padding: 4px 10px;
      background: rgba(0,0,0,0.7);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }}
    .split-badge.left {{ left: 12px; }}
    .split-badge.right {{ right: 12px; }}

    /* 全屏放大 Modal */
    .modal {{
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 9999;
      justify-content: center;
      align-items: center;
      padding: 20px;
      cursor: zoom-out;
    }}
    .modal.active {{ display: flex; }}
    .modal img {{
      max-width: 95vw;
      max-height: 95vh;
      object-fit: contain;
      box-shadow: 0 0 30px rgba(0,0,0,0.8);
    }}
  </style>
</head>
<body>

  <header class="header">
    <div class="title-group">
      <h1>🛡️ Auto Mosaic Pipeline 效果评估报告</h1>
      <p>图片：<strong>{image_name}</strong> · 分辨率：{stats.get("dimensions", "未知")}</p>
    </div>
    <div class="meta-badges">
      <span class="badge">检测器: {stats.get("detector", "YOLO")}</span>
      <span class="badge">检测耗时: {stats.get("detect_time_ms", 0):.1f}ms</span>
      <span class="badge highlight">评估组数: {len(results)} 组强度</span>
    </div>
  </header>

  <div class="view-tabs">
    <button class="tab-btn active" onclick="switchView('grid')">📊 完整画廊 (Grid)</button>
    <button class="tab-btn" onclick="switchView('slider')">↔️ 左右卷帘对比 (Split Slider)</button>
  </div>

  <!-- 1. 网格画廊视图 -->
  <div id="view-grid" class="gallery-grid">
    <!-- 原图卡片 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">原图 (Original)</span>
        <span class="card-tag" style="background:#475569;">RAW</span>
      </div>
      <div class="card-img-wrap" onclick="openModal('{original_rel}')">
        <img src="{original_rel}" alt="Original" loading="lazy">
      </div>
    </div>

    <!-- 遮罩覆盖卡片 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">AI 检测遮罩 (Mask Overlay)</span>
        <span class="card-tag" style="background:#e11d48;">AI MASK</span>
      </div>
      <div class="card-img-wrap" onclick="openModal('{overlay_rel}')">
        <img src="{overlay_rel}" alt="Mask Overlay" loading="lazy">
      </div>
    </div>

    <!-- 各打码强度卡片 -->
"""
    for res in results:
        title = res["title"]
        tag = res["tag"]
        rel_path = res["rel_path"]
        time_ms = res.get("time_ms", 0)
        html_content += f"""
    <div class="card">
      <div class="card-header">
        <span class="card-title">{title}</span>
        <span class="card-tag">{tag} · {time_ms:.1f}ms</span>
      </div>
      <div class="card-img-wrap" onclick="openModal('{rel_path}')">
        <img src="{rel_path}" alt="{title}" loading="lazy">
      </div>
    </div>
"""

    results_json = json.dumps(results, ensure_ascii=False)

    html_content += f"""
  </div>

  <!-- 2. 卷帘对比视图 -->
  <div id="view-slider" class="slider-view">
    <div class="slider-controls">
      <span class="slider-label">选择对比强度：</span>
      <div class="slider-pills" id="slider-pills"></div>
    </div>

    <div class="split-compare-container" id="splitContainer">
      <img id="splitBaseImg" class="split-image" src="{original_rel}" alt="Base">
      <div class="split-overlay" id="splitOverlay">
        <img id="splitOverlayImg" src="{results[0]['rel_path'] if results else original_rel}" alt="Overlay">
      </div>
      <div class="split-divider" id="splitDivider">
        <div class="split-handle">↔</div>
      </div>
      <span class="split-badge left" id="splitLeftLabel">打码后</span>
      <span class="split-badge right">原图 (Original)</span>
    </div>
  </div>

  <!-- 放大预览模态框 -->
  <div class="modal" id="modal" onclick="closeModal()">
    <img id="modalImg" src="" alt="Zoomed">
  </div>

  <script>
    const resultsData = {results_json};
    let activeResultIdx = 0;

    function switchView(viewName) {{
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('view-grid').style.display = viewName === 'grid' ? 'grid' : 'none';
      document.getElementById('view-slider').style.display = viewName === 'slider' ? 'flex' : 'none';
      event.target.classList.add('active');
      if (viewName === 'slider') {{
        syncSplitImages();
      }}
    }}

    // 初始化卷帘控制 Pills
    const pillsContainer = document.getElementById('slider-pills');
    resultsData.forEach((item, idx) => {{
      const btn = document.createElement('button');
      btn.className = 'pill-btn' + (idx === 0 ? ' active' : '');
      btn.textContent = item.title;
      btn.onclick = () => {{
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeResultIdx = idx;
        document.getElementById('splitOverlayImg').src = item.rel_path;
        document.getElementById('splitLeftLabel').textContent = item.title;
      }};
      pillsContainer.appendChild(btn);
    }});

    // 卷帘拖动逻辑
    const container = document.getElementById('splitContainer');
    const overlay = document.getElementById('splitOverlay');
    const overlayImg = document.getElementById('splitOverlayImg');
    const baseImg = document.getElementById('splitBaseImg');
    const divider = document.getElementById('splitDivider');
    let isDragging = false;

    function syncSplitImages() {{
      const w = container.offsetWidth;
      overlayImg.style.width = w + 'px';
    }}
    window.addEventListener('resize', syncSplitImages);

    function updateSplit(x) {{
      const rect = container.getBoundingClientRect();
      let pos = (x - rect.left) / rect.width;
      pos = Math.max(0, Math.min(1, pos));
      const pct = pos * 100;
      overlay.style.width = pct + '%';
      divider.style.left = pct + '%';
    }}

    container.addEventListener('mousedown', (e) => {{ isDragging = true; updateSplit(e.clientX); }});
    window.addEventListener('mousemove', (e) => {{ if (isDragging) updateSplit(e.clientX); }});
    window.addEventListener('mouseup', () => {{ isDragging = false; }});

    // 放大查看
    const modal = document.getElementById('modal');
    const modalImg = document.getElementById('modalImg');
    function openModal(src) {{
      modalImg.src = src;
      modal.classList.add('active');
    }}
    function closeModal() {{
      modal.classList.remove('active');
    }}
    document.addEventListener('keydown', (e) => {{
      if (e.key === 'Escape') closeModal();
    }});
  </script>
</body>
</html>
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_content, encoding="utf-8")
    print(f"[HTML] 已生成交互式对比评估报告: {output_path}")


def run_mosaic_benchmark(
    image_path: str | Path,
    output_dir: str | Path | None = None,
    detector_name: str = "yolo_sam",
    parts: Sequence[str] = ("female_nipple", "pussy", "penis"),
    method: str = "pixel",
    strengths: Sequence[int] | None = None,
    blur_radii: Sequence[int] | None = None,
    model_dir: str | Path | None = None,
    generate_grid: bool = True,
    generate_html: bool = True,
    open_browser: bool = False,
) -> dict[str, Any]:
    """执行 Auto Mosaic 自动打码测试流水线。"""
    source_path = Path(image_path).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"找不到测试图片: {source_path}")

    # 默认输出目录
    if output_dir is None:
        out_dir = source_path.parent / f"mosaic_benchmark_{source_path.stem}"
    else:
        out_dir = Path(output_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 默认强度列表
    if method == "pixel" and not strengths:
        strengths = [6, 10, 14, 18, 24, 32, 48, 64]
    elif method == "blur" and not blur_radii:
        blur_radii = [4, 8, 12, 16, 24, 36, 48]

    # 定位模型
    resolved_model_dir = find_default_model_dir(model_dir)
    if not resolved_model_dir or not resolved_model_dir.is_dir():
        print(f"[Warning] 未找到模型目录: {resolved_model_dir}，将尝试以 fallback 空遮罩运行")
        yolo_path, sam_path = None, None
    else:
        yolo_path, sam_path = locate_model_files(resolved_model_dir)
        print(f"[Model] 模型根目录: {resolved_model_dir}")
        print(f"        YOLO 模型: {yolo_path}")
        print(f"        SAM  模型: {sam_path}")

    # 1. 拷贝原图到输出目录备查
    orig_save_path = out_dir / f"00_original{source_path.suffix}"
    with Image.open(source_path) as raw_img:
        raw_img_rgb = raw_img.convert("RGB")
        raw_img_rgb.save(orig_save_path)
        img_w, img_h = raw_img_rgb.size

    # 2. 执行一次性敏感部位检测，生成遮罩
    mask_path = out_dir / "00_mask.png"
    overlay_path = out_dir / "00_mask_overlay.png"

    norm_parts = tuple(p.strip().casefold() for p in parts if p.strip())
    detector_labels = tuple(DETECTOR_LABELS[p] for p in norm_parts if p in DETECTOR_LABELS)

    print(f"\n[1/3] 开始 AI 检测敏感部位: 部位={norm_parts} (Labels={detector_labels})...")
    t_start_detect = time.perf_counter()

    if detector_name == "yolo_sam" and yolo_path and sam_path:
        detector = YoloSamDetector(yolo_path, sam_path)
        detector.create_mask(source_path, mask_path, detector_labels)
        actual_detector = "YOLO + SAM (精确分割)"
    elif yolo_path:
        detector = YoloDetector(yolo_path)
        detector.create_mask(source_path, mask_path, detector_labels)
        actual_detector = "YOLO (矩形框)"
    else:
        print("[Warning] 缺少模型权重，生成全图中心测试矩形遮罩...")
        _write_empty_mask(source_path, mask_path)
        actual_detector = "Fallback"

    t_detect_ms = (time.perf_counter() - t_start_detect) * 1000
    print(f"      检测完成，耗时: {t_detect_ms:.1f}ms")

    # 生成半透明覆盖图
    with Image.open(source_path) as src_im, Image.open(mask_path) as msk_im:
        overlay_img = create_mask_overlay(src_im, msk_im)
        overlay_img.save(overlay_path)

    # 3. 批量执行不同强度的打码
    print(f"\n[2/3] 开始批量生成各强度打码图片...")
    processor = ImageMosaicProcessor()
    grid_items: list[tuple[str, str, Path]] = [
        ("Original", f"{img_w}x{img_h}", orig_save_path),
        ("Mask Overlay", "AI Detected", overlay_path),
    ]
    results_meta: list[dict[str, Any]] = []

    if method in ("pixel", "all"):
        for psize in (strengths or [8, 12, 16, 24, 32, 48]):
            out_file = out_dir / f"pixel_size_{psize:02d}.png"
            settings = MosaicSettings(
                detector=detector_name,
                method="pixel",
                parts=norm_parts,
                pixel_size=psize,
            )
            t0 = time.perf_counter()
            processor.process(source_path, mask_path, out_file, settings)
            t_ms = (time.perf_counter() - t0) * 1000
            print(f"      ✔ Pixel (像素块: {psize:2d}px) -> {out_file.name} ({t_ms:.1f}ms)")
            grid_items.append((f"Pixel: {psize}px", f"耗时 {t_ms:.1f}ms", out_file))
            results_meta.append(
                {
                    "method": "pixel",
                    "title": f"像素马赛克 ({psize}px)",
                    "tag": f"Pixel {psize}px",
                    "intensity": psize,
                    "rel_path": out_file.name,
                    "time_ms": t_ms,
                }
            )

    if method in ("blur", "all"):
        for bradius in (blur_radii or [6, 12, 18, 24, 36, 48]):
            out_file = out_dir / f"blur_radius_{bradius:02d}.png"
            settings = MosaicSettings(
                detector=detector_name,
                method="blur",
                parts=norm_parts,
                blur_radius=bradius,
            )
            t0 = time.perf_counter()
            processor.process(source_path, mask_path, out_file, settings)
            t_ms = (time.perf_counter() - t0) * 1000
            print(f"      ✔ Blur (高斯模糊: {bradius:2d}px) -> {out_file.name} ({t_ms:.1f}ms)")
            grid_items.append((f"Blur: {bradius}px", f"耗时 {t_ms:.1f}ms", out_file))
            results_meta.append(
                {
                    "method": "blur",
                    "title": f"高斯模糊 (半径 {bradius}px)",
                    "tag": f"Blur {bradius}px",
                    "intensity": bradius,
                    "rel_path": out_file.name,
                    "time_ms": t_ms,
                }
            )

    # 4. 生成对比网格图与 HTML 报告
    print(f"\n[3/3] 正在生成对比全景大图与可视化报告...")
    stats = {
        "image_path": str(source_path),
        "dimensions": f"{img_w} × {img_h}",
        "detector": actual_detector,
        "detect_time_ms": t_detect_ms,
    }

    if generate_grid:
        grid_out = out_dir / "comparison_grid.png"
        generate_comparison_grid(grid_items, grid_out)

    if generate_html:
        html_out = out_dir / "comparison.html"
        generate_comparison_html(
            image_name=source_path.name,
            original_rel=orig_save_path.name,
            mask_rel=mask_path.name,
            overlay_rel=overlay_path.name,
            results=results_meta,
            output_path=html_out,
            stats=stats,
        )
        if open_browser:
            webbrowser.open(html_out.as_uri())

    # 保存 JSON 元数据
    summary_path = out_dir / "summary.json"
    summary_data = {
        "stats": stats,
        "results": results_meta,
    }
    summary_path.write_text(json.dumps(summary_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n✨ 全部测试完成！结果目录: {out_dir}\n")
    return summary_data


def main():
    parser = argparse.ArgumentParser(
        description="Auto Mosaic Pipeline 自动打码测试与多强度对比工具",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("image", help="待测试打码的源图片路径")
    parser.add_argument(
        "-o", "--output-dir",
        help="输出结果目录 (默认保存在图片同级 mosaic_benchmark_<name> 目录)",
    )
    parser.add_argument(
        "-d", "--detector",
        choices=["yolo", "yolo_sam"],
        default="yolo_sam",
        help="使用的敏感部位检测器 (yolo_sam 精确分割，yolo 矩形框)",
    )
    parser.add_argument(
        "-m", "--method",
        choices=["pixel", "blur", "all"],
        default="pixel",
        help="打码方式 (pixel 像素马赛克, blur 高斯模糊, all 两者均测试)",
    )
    parser.add_argument(
        "-s", "--strengths",
        type=int,
        nargs="+",
        default=[6, 10, 14, 18, 24, 32, 48, 64],
        help="像素马赛克大小 (Pixel Sizes) 强度列表",
    )
    parser.add_argument(
        "-b", "--blur-radii",
        type=int,
        nargs="+",
        default=[4, 8, 12, 16, 24, 36, 48],
        help="高斯模糊半径 (Blur Radii) 强度列表",
    )
    parser.add_argument(
        "-p", "--parts",
        default="female_nipple,pussy,penis",
        help="检测部位 (逗号分隔，如 female_nipple,pussy,penis)",
    )
    parser.add_argument(
        "--model-dir",
        help="自定义 YOLO/SAM 模型所在根目录 (默认自动探测)",
    )
    parser.add_argument(
        "--no-grid",
        action="store_true",
        help="不生成多图拼接的 comparison_grid.png 大图",
    )
    parser.add_argument(
        "--no-html",
        action="store_true",
        help="不生成交互式 comparison.html 对比网页",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="处理完成后自动在默认浏览器中打开对比网页",
    )

    args = parser.parse_args()

    parts_list = [p.strip() for p in args.parts.split(",") if p.strip()]

    run_mosaic_benchmark(
        image_path=args.image,
        output_dir=args.output_dir,
        detector_name=args.detector,
        parts=parts_list,
        method=args.method,
        strengths=args.strengths,
        blur_radii=args.blur_radii,
        model_dir=args.model_dir,
        generate_grid=not args.no_grid,
        generate_html=not args.no_html,
        open_browser=args.open,
    )


if __name__ == "__main__":
    main()
