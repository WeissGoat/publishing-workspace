from pathlib import Path
import json
import io
from PIL import Image
import pytest

from publishing_workspace.inpaint.client import NovelAIInpaintClient


def extract_inpaint_request_from_har(har_path: Path) -> dict:
    with open(har_path, "r", encoding="utf-8") as f:
        har_data = json.load(f)

    for entry in har_data.get("log", {}).get("entries", []):
        req = entry.get("request", {})
        url = req.get("url", "")
        if "generate-image" in url and req.get("method") == "POST":
            post_data = req.get("postData", {})
            raw_text = post_data.get("text", "")
            if 'name="request"' in raw_text:
                # 提取 name="request" 后的 JSON 内容
                idx = raw_text.find('name="request"')
                # 寻找紧接着的空行 \r\n\r\n 或 \n\n
                start = raw_text.find("{", idx)
                if start != -1:
                    # 查找对应的 JSON 结束或者 boundary
                    for end in range(len(raw_text), start, -1):
                        snippet = raw_text[start:end]
                        try:
                            val = json.loads(snippet)
                            if val.get("action") == "infill":
                                return val
                        except Exception:
                            continue
    return {}


def test_novelai_har_parity_and_payload_consistency():
    har_path = Path("tmp/novelai/novelai.net.har")
    if not har_path.is_file():
        pytest.skip("HAR 抓包文件 tmp/novelai/novelai.net.har 不存在，跳过 parity 测试")

    har_req = extract_inpaint_request_from_har(har_path)
    assert har_req, "在 HAR 文件中未找到 action='infill' 的局部重绘请求！"

    # HAR 关键字段提取
    har_model = har_req.get("model")
    har_action = har_req.get("action")
    har_params = har_req.get("parameters", {})

    print(f"\n[HAR Parity] Model: {har_model}")
    print(f"[HAR Parity] Action: {har_action}")
    print(f"[HAR Parity] Params keys: {list(har_params.keys())}")

    # 验证关键协议字段在 HAR 中的存在性与取值
    assert har_action == "infill"
    assert "nai-diffusion" in har_model and "inpaint" in har_model
    assert "params_version" in har_params
    assert "inpaintImg2ImgStrength" in har_params
    assert "strength" in har_params
    assert "v4_prompt" in har_params
    assert "v4_negative_prompt" in har_params

    # 现在使用我们的 Client 构造参数
    client = NovelAIInpaintClient(token="dummy_token")
    built = client.build_parameters(
        width=har_params.get("width", 832),
        height=har_params.get("height", 1216),
        prompt="1girl, detailed face",
        negative_prompt="bad anatomy",
        strength=0.70,
        seed=12345678,
        steps=har_params.get("steps", 28),
        scale=har_params.get("scale", 6.0),
        sampler=har_params.get("sampler", "k_euler"),
        noise_schedule=har_params.get("noise_schedule", "karras"),
        model=har_model,
    )

    built_params = built

    # 1. parameters 关键字段比对
    assert built_params["params_version"] == har_params["params_version"]
    assert built_params["inpaintImg2ImgStrength"] == har_params["inpaintImg2ImgStrength"]
    assert built_params["image"] == har_params["image"] == "image"
    assert built_params["mask"] == har_params["mask"] == "mask"
    assert built_params["strength"] == 0.70
    assert built_params["seed"] == 12345678
    assert built_params["steps"] == har_params["steps"]
    assert built_params["scale"] == har_params["scale"]
    assert built_params["noise_schedule"] == har_params["noise_schedule"]
    assert built_params["sampler"] == har_params["sampler"]

    # 2. v4_prompt 与 v4_negative_prompt 结构比对
    assert "caption" in built_params["v4_prompt"]
    assert "base_caption" in built_params["v4_prompt"]["caption"]
    assert built_params["v4_prompt"]["caption"]["base_caption"] == "1girl, detailed face"
    assert built_params["v4_prompt"]["use_order"] == har_params["v4_prompt"]["use_order"]
    assert built_params["v4_prompt"]["use_coords"] == har_params["v4_prompt"]["use_coords"]

    assert "caption" in built_params["v4_negative_prompt"]
    assert "base_caption" in built_params["v4_negative_prompt"]["caption"]
    assert built_params["v4_negative_prompt"]["caption"]["base_caption"] == "bad anatomy"
    assert "use_coords" not in built_params["v4_negative_prompt"]
    assert "use_order" not in built_params["v4_negative_prompt"]

    print("\n[SUCCESS] Inpaint protocol parameters match NovelAI official HAR 100%!")
