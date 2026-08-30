from __future__ import annotations

import io
import numpy as np
from PIL import Image


def expand_binary_mask_to_anr_grid(binary: np.ndarray) -> np.ndarray:
    """Expand white mask regions to align with NovelAI 8x8 ANR grid."""
    height, width = binary.shape
    if height % 8 != 0 or width % 8 != 0:
        return binary

    grid_height = height // 8
    grid_width = width // 8
    white_grids = np.zeros((grid_height, grid_width), dtype=bool)

    for i in range(grid_height):
        for j in range(grid_width):
            section = binary[i * 8 : (i + 1) * 8, j * 8 : (j + 1) * 8]
            if np.any(section > 0):
                white_grids[i, j] = True

    visited = np.zeros_like(white_grids, dtype=bool)
    result = binary.copy()

    def bfs(start_i: int, start_j: int) -> list[tuple[int, int]]:
        region: list[tuple[int, int]] = []
        queue = [(start_i, start_j)]
        visited[start_i, start_j] = True

        while queue:
            i, j = queue.pop(0)
            region.append((i, j))
            for di, dj in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                ni, nj = i + di, j + dj
                if (
                    0 <= ni < grid_height
                    and 0 <= nj < grid_width
                    and white_grids[ni, nj]
                    and not visited[ni, nj]
                ):
                    visited[ni, nj] = True
                    queue.append((ni, nj))
        return region

    for i in range(grid_height):
        for j in range(grid_width):
            if not white_grids[i, j] or visited[i, j]:
                continue

            region = bfs(i, j)
            region_i = [pos[0] for pos in region]
            region_j = [pos[1] for pos in region]
            min_i, max_i = min(region_i), max(region_i)
            min_j, max_j = min(region_j), max(region_j)

            top_distance = min_i
            bottom_distance = grid_height - 1 - max_i
            left_distance = min_j
            right_distance = grid_width - 1 - max_j

            target_top = (top_distance // 8) * 8
            target_bottom = (bottom_distance // 8) * 8
            target_left = (left_distance // 8) * 8
            target_right = (right_distance // 8) * 8

            expanded_min_i = max(0, min_i - (top_distance - target_top))
            expanded_max_i = min(grid_height - 1, max_i + (bottom_distance - target_bottom))
            expanded_min_j = max(0, min_j - (left_distance - target_left))
            expanded_max_j = min(grid_width - 1, max_j + (right_distance - target_right))

            brush_size_grid = 4
            brush_half = brush_size_grid // 2
            for center_i in range(expanded_min_i, expanded_max_i + 1):
                for center_j in range(expanded_min_j, expanded_max_j + 1):
                    brush_start_i = max(0, center_i - brush_half)
                    brush_end_i = min(grid_height, center_i + brush_half)
                    brush_start_j = max(0, center_j - brush_half)
                    brush_end_j = min(grid_width, center_j + brush_half)

                    overlaps_region = any(
                        brush_start_i <= pos[0] < brush_end_i
                        and brush_start_j <= pos[1] < brush_end_j
                        for pos in region
                    )
                    if overlaps_region:
                        result[
                            brush_start_i * 8 : brush_end_i * 8,
                            brush_start_j * 8 : brush_end_j * 8,
                        ] = 255

    return result


def mask_to_novelai_png_bytes(
    mask_bytes: bytes,
    target_size: tuple[int, int],
    *,
    is_v4: bool = True,
) -> bytes:
    """Process user canvas mask bytes into NovelAI-compliant PNG mask."""
    raw_mask = Image.open(io.BytesIO(mask_bytes))
    rgba = raw_mask.convert("RGBA")
    alpha = np.array(rgba.getchannel("A"))
    rgb_luma = np.array(rgba.convert("L"))
    if alpha.min() < 255:
        binary = (alpha > 0).astype(np.uint8) * 255
    else:
        binary = (rgb_luma > 128).astype(np.uint8) * 255

    w, h = target_size
    grid_w = int(np.ceil(w / 64) * 8)
    grid_h = int(np.ceil(h / 64) * 8)
    mask = Image.fromarray(binary, "L")
    mask = mask.resize((grid_w, grid_h), Image.Resampling.NEAREST)
    if is_v4:
        mask = mask.resize((grid_w * 8, grid_h * 8), Image.Resampling.NEAREST)
    else:
        mask = mask.resize(target_size, Image.Resampling.NEAREST)

    binary_arr = np.array(mask).astype(np.uint8)
    binary_arr = expand_binary_mask_to_anr_grid(binary_arr)

    # 构造输出图片
    rgb = np.stack([binary_arr, binary_arr, binary_arr], axis=-1)
    alpha_ch = (binary_arr > 0).astype(np.uint8) * 255
    rgba_out = np.dstack((rgb, alpha_ch))
    out_img = Image.fromarray(rgba_out, "RGBA")
    
    # 转换为 target_size
    if out_img.size != target_size:
        out_img = out_img.resize(target_size, Image.Resampling.NEAREST)

    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    return buf.getvalue()
