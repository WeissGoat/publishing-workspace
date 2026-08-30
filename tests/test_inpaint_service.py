from pathlib import Path
import io
import pytest
from PIL import Image
from publishing_workspace.inpaint.mask import expand_binary_mask_to_anr_grid, mask_to_novelai_png_bytes
from publishing_workspace.inpaint.client import NovelAIInpaintClient, resolve_novelai_token
from publishing_workspace.inpaint.models import InpaintCandidate, InpaintSessionResult
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


def test_token_resolution():
    token = resolve_novelai_token()
    # 本机存在 client.py 或环境变量，应成功解析出非空 token
    assert token is not None
    assert len(token) > 10


def test_inpaint_payload_builder():
    client = NovelAIInpaintClient()
    payload = client.build_parameters(
        width=832,
        height=1216,
        prompt="1girl, masterpiece",
        negative_prompt="low quality",
        strength=0.7,
        seed=12345678,
        steps=28,
        scale=6.0,
        sampler="k_euler_ancestral",
        noise_schedule="karras",
        model="nai-diffusion-4-5-full",
    )
    assert payload["params_version"] == 4
    assert payload["width"] == 832
    assert payload["height"] == 1216
    assert payload["scale"] == 6.0
    assert payload["sampler"] == "k_euler_ancestral"
    assert payload["noise_schedule"] == "karras"
    assert payload["strength"] == 0.7
    assert payload["inpaintImg2ImgStrength"] == 1.0
    assert payload["image"] == "image"
    assert payload["mask"] == "mask"
    assert "v4_prompt" in payload
    assert payload["v4_prompt"]["caption"]["base_caption"] == "1girl, masterpiece"


@pytest.mark.anyio
async def test_inpaint_service_generate_and_apply(tmp_path: Path):
    from publishing_workspace.config import init_workspace
    from publishing_workspace.catalog.repository import CatalogRepository
    from publishing_workspace.inpaint.client import NovelAIInpaintClient

    # 创建测试工作空间
    paths, _, _ = init_workspace(tmp_path)
    catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
    catalog.initialize()

    # 创建测试原图 (绿色 64x64)
    img_dir = tmp_path / "source"
    img_dir.mkdir(parents=True, exist_ok=True)
    orig_img_path = img_dir / "test_girl.png"
    Image.new("RGB", (64, 64), "green").save(orig_img_path)

    # Ingest 到 catalog
    with catalog.connection() as conn:
        stat = orig_img_path.stat()
        from publishing_workspace.metadata.registry import default_image_node_reader_registry
        res = catalog.ingest_asset(
            conn,
            orig_img_path,
            expected_size=stat.st_size,
            expected_modified_ns=stat.st_mtime_ns,
            readers=default_image_node_reader_registry(),
            enrichers=[],
        )
        asset_id = res.asset.asset_id

    # 创建 Mock Client (返回红色 64x64)
    class MockClient(NovelAIInpaintClient):
        async def generate_single(self, **kwargs):
            buf = io.BytesIO()
            Image.new("RGB", (64, 64), "red").save(buf, format="PNG")
            return buf.getvalue(), 99998888

    service = InpaintService(client=MockClient())

    # 绘制测试遮罩
    mask_buf = io.BytesIO()
    Image.new("L", (64, 64), 255).save(mask_buf, format="PNG")

    # 1. 发起 Inpaint 生成 2 张
    gen_result = await service.generate(
        paths=paths,
        asset_id=asset_id,
        mask_bytes=mask_buf.getvalue(),
        prompt="1girl, red hair",
        negative_prompt="bad",
        strength=0.75,
        count=2,
    )
    assert len(gen_result.candidates) == 2
    assert gen_result.candidates[0].candidate_id == "cand_0"
    assert gen_result.candidates[1].candidate_id == "cand_1"

    # 2. 确认应用第 1 张候选图
    apply_result = service.apply_candidate(
        paths=paths,
        asset_id=asset_id,
        session_id=gen_result.session_id,
        candidate_id="cand_0",
    )
    assert apply_result["success"] is True
    new_asset_id = apply_result["new_asset_id"]

    # 3. 验证原图文件已变为红色图片
    with Image.open(orig_img_path) as current_img:
        # 获取中心像素颜色
        pixel = current_img.getpixel((32, 32))
        assert pixel == (255, 0, 0)


@pytest.mark.anyio
async def test_inpaint_client_retry_on_429(monkeypatch):
    """测试 NovelAI Client 在遇到 429 时进行重试并成功返回。"""
    import httpx

    calls = 0

    class MockResponse:
        def __init__(self, status_code: int, content: bytes = b"", text: str = ""):
            self.status_code = status_code
            self.content = content
            self.text = text

    async def mock_post(self, url, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return MockResponse(429, text="Too Many Requests")
        # 第 2 次返回 zip 包 (模拟成功)
        buf = io.BytesIO()
        Image.new("RGB", (64, 64), "blue").save(buf, format="PNG")
        png_bytes = buf.getvalue()

        zip_buf = io.BytesIO()
        import zipfile
        with zipfile.ZipFile(zip_buf, "w") as zf:
            zf.writestr("image_0.png", png_bytes)

        return MockResponse(200, content=zip_buf.getvalue())

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    client = NovelAIInpaintClient(token="mock-token")
    img_buf = io.BytesIO()
    Image.new("RGB", (64, 64), "green").save(img_buf, format="PNG")
    mask_buf = io.BytesIO()
    Image.new("L", (64, 64), 255).save(mask_buf, format="PNG")

    img_res, seed = await client.generate_single(
        image_bytes=img_buf.getvalue(),
        mask_bytes=mask_buf.getvalue(),
        prompt="1girl",
        negative_prompt="",
    )
    assert len(img_res) > 0
    assert calls == 2  # 验证第 1 次 429 后成功进行了第 2 次重试


@pytest.mark.anyio
async def test_inpaint_service_cascades_to_tasks_and_exports(tmp_path: Path):
    """测试重绘覆盖后，既有投稿任务的 selection 文件与导出构建包自动同步为最新重绘图。"""
    from publishing_workspace.config import init_workspace
    from publishing_workspace.catalog.repository import CatalogRepository
    from publishing_workspace.submissions.service import SubmissionService
    from publishing_workspace.packages.builder import PackageBuilder
    from publishing_workspace.metadata.registry import default_image_node_reader_registry
    from publishing_workspace.tasks.paths import TaskPaths
    from publishing_workspace.inpaint.client import NovelAIInpaintClient

    paths, _, _ = init_workspace(tmp_path)
    catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)

    # 1. 导入初始绿色原图 (64x64) 并记录为快照 import-test
    source_dir = tmp_path / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    img_path = source_dir / "sample.png"
    Image.new("RGB", (64, 64), "green").save(img_path)

    from publishing_workspace.models import SelectionSet, ImportedItem
    selection = SelectionSet(
        id="import-test",
        source_type="directory",
        source_ref=str(source_dir),
        items=[
            ImportedItem(
                source_path=str(img_path),
                resolved_path=str(img_path),
                source_type="directory",
                source_ref=str(source_dir),
                source_order=0,
                display_name="sample.png",
            )
        ],
    )
    catalog.import_selection(
        selection,
        readers=default_image_node_reader_registry(),
        enrichers=[],
    )
    imported = catalog.assets_for_import("import-test")
    assert len(imported) == 1
    asset_id = imported[0].asset_id

    # 2. 创建并保存一个包含该素材的投稿任务
    sub_service = SubmissionService()
    sub_res = sub_service.create_or_update(
        tmp_path,
        task_id=None,
        title="测试投稿",
        source_import_id="import-test",
        sets={"all": [asset_id], "post": [asset_id], "cover": [asset_id]},
    )
    task_id = sub_res.task_id
    task_paths = TaskPaths.from_workspace(paths, task_id)

    # 验证 selection 目录下已物化为初始绿色图片
    for sel in ("all", "post", "cover"):
        files = list(task_paths.selection_dirs[sel].glob("*.png"))
        assert len(files) == 1
        file_path = files[0]
        assert file_path.is_file()
        with Image.open(file_path) as im:
            assert im.getpixel((32, 32)) == (0, 128, 0)

    # 3. 对原图进行重绘（重绘结果为黄色 (255, 255, 0)）
    class MockYellowClient(NovelAIInpaintClient):
        async def generate_single(self, **kwargs):
            buf = io.BytesIO()
            Image.new("RGB", (64, 64), "yellow").save(buf, format="PNG")
            return buf.getvalue(), 112233

    inpaint_svc = InpaintService(client=MockYellowClient())
    mask_buf = io.BytesIO()
    Image.new("L", (64, 64), 255).save(mask_buf, format="PNG")

    gen_res = await inpaint_svc.generate(
        paths=paths,
        asset_id=asset_id,
        mask_bytes=mask_buf.getvalue(),
        count=1,
    )
    apply_res = inpaint_svc.apply_candidate(
        paths=paths,
        asset_id=asset_id,
        session_id=gen_res.session_id,
        candidate_id="cand_0",
    )
    assert apply_res["success"] is True
    new_asset_id = apply_res["new_asset_id"]

    # 4. 验证任务 selection 目录下的图片已被自动级联替换为黄色图片！
    for sel in ("all", "post", "cover"):
        files = list(task_paths.selection_dirs[sel].glob("*.png"))
        assert len(files) == 1
        file_path = files[0]
        assert file_path.is_file()
        with Image.open(file_path) as im:
            assert im.getpixel((32, 32)) == (255, 255, 0)

    # 5. 验证执行导出构建时，输出的发布包图片也是最新的重绘黄色图片！
    builder = PackageBuilder()
    build_res = builder.build(tmp_path, task_id)
    assert build_res.build_root.is_dir()
    for sel in ("all", "post", "cover"):
        out_files = list((build_res.build_root / "output" / sel).glob("*.png"))
        assert len(out_files) == 1
        with Image.open(out_files[0]) as im:
            assert im.getpixel((32, 32)) == (255, 255, 0)

    # 6. 验证即便用旧 asset_id 查询，Catalog 也能平滑降级找到当前物理图片与记录
    old_queried_path = catalog.get_asset_path(asset_id)
    assert old_queried_path is not None
    assert Path(old_queried_path).is_file()
    with Image.open(old_queried_path) as im:
        assert im.getpixel((32, 32)) == (255, 255, 0)

    # 7. 验证快照导入表 import_items 也已被同步更新，查询快照素材返回最新黄色重绘图
    snapshot_assets = catalog.assets_for_import("import-test")
    assert len(snapshot_assets) == 1
    assert snapshot_assets[0].asset_id == new_asset_id
    assert snapshot_assets[0].path == str(img_path)


