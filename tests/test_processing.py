from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image, PngImagePlugin

from publishing_workspace.processing import ImageProcessingPipeline
from publishing_workspace.processing.models import ProcessingResult
from publishing_workspace.tasks import OperationConfig, ProcessingConfig
from publishing_workspace.png_metadata import read_png_text_chunks


def _image(path: Path, color: str = "white", text: dict[str, str] | None = None) -> Path:
    image = Image.new("RGB", (8, 8), color=color)
    if text:
        info = PngImagePlugin.PngInfo()
        for key, value in text.items():
            info.add_text(key, value)
        image.save(path, pnginfo=info)
    else:
        image.save(path)
    return path


def test_strip_metadata_removes_png_text_and_preserves_dimensions(tmp_path: Path):
    source = _image(
        tmp_path / "source.png",
        text={"prompt": "secret", "seed": "42"},
    )
    output = tmp_path / "output.png"

    result = ImageProcessingPipeline().process(
        source,
        output,
        ProcessingConfig(profile="pixiv_default"),
    )

    assert isinstance(result, ProcessingResult)
    assert Image.open(output).size == Image.open(source).size
    assert read_png_text_chunks(output) == {}


def test_processing_cache_reuses_same_input_and_config(tmp_path: Path):
    source = _image(tmp_path / "source.png")
    first = tmp_path / "first.png"
    second = tmp_path / "second.png"
    pipeline = ImageProcessingPipeline(cache_root=tmp_path / "cache")
    config = ProcessingConfig(profile="pixiv_default")

    first_result = pipeline.process(source, first, config)
    second_result = pipeline.process(source, second, config)

    assert first_result.cache_hit is False
    assert second_result.cache_hit is True
    assert first.read_bytes() == second.read_bytes()


def test_mosaic_without_adapter_fails_before_output(tmp_path: Path):
    with pytest.raises(ValueError, match="mosaic.*adapter"):
        ImageProcessingPipeline().process(
            _image(tmp_path / "source.png"),
            tmp_path / "output.png",
            ProcessingConfig(
                operations={"mosaic": OperationConfig(enabled=True, adapter="missing_adapter")},
            ),
        )


def test_pipeline_processes_strip_metadata_and_mosaic_together(tmp_path: Path):
    from publishing_workspace.processing.operations import default_operation_registry

    class FakeMosaicAdapter:
        name = "test_mosaic"

        def process(self, source: Path, target: Path, options: dict) -> None:
            img = Image.open(source).convert("RGB")
            # 在中心像素涂上灰色作为打码效果
            img.putpixel((4, 4), (128, 128, 128))
            target.parent.mkdir(parents=True, exist_ok=True)
            img.save(target)

    registry = default_operation_registry({"test_mosaic": FakeMosaicAdapter()})
    pipeline = ImageProcessingPipeline(cache_root=tmp_path / "cache", registry=registry)

    source = _image(
        tmp_path / "source.png",
        color="red",
        text={"prompt": "1girl, anime", "workflow": "{}"},
    )
    output = tmp_path / "output.png"

    config = ProcessingConfig(
        profile="pixiv_mosaic",
        operations={
            "strip_metadata": OperationConfig(enabled=True),
            "mosaic": OperationConfig(
                enabled=True,
                adapter="test_mosaic",
                options={"detector": "yolo", "method": "pixelate"},
            ),
        },
    )

    # 首次处理
    result1 = pipeline.process(source, output, config)
    assert result1.cache_hit is False
    assert result1.processed_operations == ["strip_metadata", "mosaic"]
    assert result1.skipped_operations == []
    assert read_png_text_chunks(output) == {}  # 确认 Prompt 已剥离
    assert Image.open(output).getpixel((4, 4)) == (128, 128, 128)  # 确认已打码
    assert Image.open(output).getpixel((0, 0)) == (255, 0, 0)  # 确认非打码区保持原色

    # 二次处理（命中缓存）
    second_output = tmp_path / "output2.png"
    result2 = pipeline.process(source, second_output, config)
    assert result2.cache_hit is True
    assert second_output.read_bytes() == output.read_bytes()

