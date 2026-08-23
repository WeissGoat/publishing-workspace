from __future__ import annotations

import hashlib
import logging
import shutil
from pathlib import Path

import pytest
from PIL import Image

from publishing_workspace.config import MosaicIntegrationConfig, MosaicModelConfig, init_workspace
from publishing_workspace.integrations.anr_mosaic import AnrAutoMosaicsAdapter
from publishing_workspace.tasks import OperationConfig, ProcessingConfig, TaskConfig, TaskPaths, TaskRepository
from publishing_workspace.packages import PackageBuilder


def _config(tmp_path: Path, data: bytes = b"model") -> MosaicIntegrationConfig:
    return MosaicIntegrationConfig(
        model_root="models",
        models={
            "yolo": MosaicModelConfig(
                filename="yolo/censor.pt",
                url="https://example.invalid/censor.pt",
                sha256=hashlib.sha256(data).hexdigest(),
            )
        },
    )


def test_adapter_processes_with_fake_yolo_and_keeps_target_boundary(tmp_path: Path, monkeypatch):
    import publishing_workspace.integrations.anr_mosaic.adapter as adapter_module

    class FakeYolo:
        def __init__(self, model_path: Path):
            assert model_path.is_file()

        def create_mask(self, source: Path, target: Path, labels: tuple[str, ...]) -> None:
            mask = Image.new("L", (16, 12), 0)
            for x in range(4, 12):
                for y in range(3, 9):
                    mask.putpixel((x, y), 255)
            mask.save(target)

    monkeypatch.setattr(adapter_module, "YoloDetector", FakeYolo)
    paths, _, _ = init_workspace(tmp_path / "publish")
    data = b"model"
    config = _config(tmp_path, data)
    model = paths.root / "models" / "yolo" / "censor.pt"
    model.parent.mkdir(parents=True)
    model.write_bytes(data)
    source = tmp_path / "source.png"
    target = tmp_path / "output" / "result.png"
    Image.new("RGB", (16, 12), (10, 20, 30)).save(source)

    AnrAutoMosaicsAdapter(paths, config).process(
        source,
        target,
        {"detector": "yolo", "method": "solid", "parts": ["penis"]},
    )

    assert target.is_file()
    assert Image.open(target).getpixel((8, 6)) == (128, 128, 128)
    assert Image.open(target).getpixel((0, 0)) == (10, 20, 30)
    assert not list(target.parent.glob(".mosaic-*"))


def test_adapter_anus_only_does_not_load_detector(tmp_path: Path, caplog):
    caplog.set_level(logging.WARNING)
    paths, _, _ = init_workspace(tmp_path / "publish")
    config = _config(tmp_path)
    source = tmp_path / "source.png"
    target = tmp_path / "target.png"
    Image.new("RGB", (4, 4), (10, 20, 30)).save(source)

    AnrAutoMosaicsAdapter(paths, config).process(
        source,
        target,
        {"detector": "yolo", "method": "solid", "parts": ["anus"]},
    )

    assert target.read_bytes() == source.read_bytes()
    assert "不支持部位 anus" in caplog.text


def test_adapter_rejects_missing_model_before_detector_load(tmp_path: Path):
    paths, _, _ = init_workspace(tmp_path / "publish")
    source = tmp_path / "source.png"
    target = tmp_path / "target.png"
    Image.new("RGB", (4, 4), "white").save(source)

    with pytest.raises(ValueError, match="模型不可用"):
        AnrAutoMosaicsAdapter(paths, _config(tmp_path)).process(
            source,
            target,
            {"detector": "yolo", "method": "solid", "parts": ["penis"]},
        )
    assert not target.exists()


def test_package_builder_creates_default_registry_with_mosaic_adapter(tmp_path: Path, monkeypatch):
    import publishing_workspace.packages.builder as builder_module

    class FakeAdapter:
        name = "anr_plugin_auto_mosaics"

        def __init__(self, paths, config):
            pass

        def process(self, source: Path, target: Path, options: dict) -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())

    monkeypatch.setattr(builder_module, "AnrAutoMosaicsAdapter", FakeAdapter)
    root = tmp_path / "publish"
    paths, _, _ = init_workspace(root)
    task_paths = TaskPaths.from_workspace(paths, "task-001")
    TaskRepository.create(task_paths, title="mosaic")
    source = tmp_path / "source.png"
    Image.new("RGB", (4, 4), "white").save(source)
    task_paths.selection_dirs["all"].mkdir(parents=True, exist_ok=True)
    (task_paths.selection_dirs["all"] / "source.png").write_bytes(source.read_bytes())
    TaskRepository.save(
        task_paths,
        TaskConfig(
            task_id="task-001",
            title="mosaic",
            processing=ProcessingConfig(
                operations={
                    "mosaic": OperationConfig(
                        enabled=True,
                        adapter="anr_plugin_auto_mosaics",
                    )
                }
            ),
        ),
    )

    result = PackageBuilder().build(root, "task-001")

    assert result.output_paths["all"].joinpath("source.png").is_file()


def test_package_builder_with_mosaic_pipeline_end_to_end(tmp_path: Path, monkeypatch):
    import publishing_workspace.integrations.anr_mosaic.adapter as adapter_module
    import yaml

    class FakeYolo:
        def __init__(self, model_path: Path):
            pass

        def create_mask(self, source: Path, target: Path, labels: tuple[str, ...]) -> None:
            mask = Image.new("L", (16, 16), 0)
            for x in range(4, 12):
                for y in range(4, 12):
                    mask.putpixel((x, y), 255)
            mask.save(target)

    monkeypatch.setattr(adapter_module, "YoloDetector", FakeYolo)

    root = tmp_path / "publish"
    paths, _, _ = init_workspace(root)

    # 准备模型文件并写入配置
    model_data = b"fake_yolo_model_content"
    config = _config(tmp_path, model_data)
    model_file = paths.root / "models" / "yolo" / "censor.pt"
    model_file.parent.mkdir(parents=True, exist_ok=True)
    model_file.write_bytes(model_data)

    # 更新 workspace.yaml 中的 mosaic 配置
    ws_data = yaml.safe_load(paths.config.read_text(encoding="utf-8"))
    ws_data["integrations"]["mosaic"] = config.model_dump(mode="json")
    paths.config.write_text(yaml.safe_dump(ws_data), encoding="utf-8")

    task_paths = TaskPaths.from_workspace(paths, "task-mosaic-01")
    TaskRepository.create(task_paths, title="打码测试任务")

    source_img = tmp_path / "raw.png"
    Image.new("RGB", (16, 16), (255, 0, 0)).save(source_img)

    task_paths.selection_dirs["all"].mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_img, task_paths.selection_dirs["all"] / "0001_raw.png")

    TaskRepository.save(
        task_paths,
        TaskConfig(
            task_id="task-mosaic-01",
            title="打码测试任务",
            processing=ProcessingConfig(
                operations={
                    "strip_metadata": OperationConfig(enabled=True),
                    "mosaic": OperationConfig(
                        enabled=True,
                        adapter="anr_plugin_auto_mosaics",
                        options={"detector": "yolo", "method": "solid", "parts": ["penis"]},
                    ),
                }
            ),
        ),
    )

    builder = PackageBuilder()
    result = builder.build(root, "task-mosaic-01")

    # 验证最新构建目录与产物
    assert result.build_root.name == "latest"
    output_file = result.output_paths["all"] / "0001_raw.png"
    assert output_file.is_file()

    # 验证打码效果：打码区变为灰色，非打码区保持红色
    processed_img = Image.open(output_file)
    assert processed_img.getpixel((8, 8)) == (128, 128, 128)
    assert processed_img.getpixel((0, 0)) == (255, 0, 0)

