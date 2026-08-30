from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path


TRACE_LEVEL = 5
logging.addLevelName(TRACE_LEVEL, "TRACE")


def configure_logging(
    level: str | None = None,
    log_file: str | Path | None = None,
    workspace_root: str | Path | None = None,
) -> None:
    selected = (level or os.environ.get("PUBLISHING_WORKSPACE_LOG_LEVEL") or "info").lower()
    numeric = {
        "trace": TRACE_LEVEL,
        "info": logging.INFO,
        "warning": logging.WARNING,
        "error": logging.ERROR,
    }.get(selected, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(numeric)

    # 移除现有 handler，避免重复输出
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 控制台输出 Handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(numeric)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    # 文件输出 Handler
    target_file = log_file or os.environ.get("PUBLISHING_WORKSPACE_LOG_FILE")
    if not target_file and workspace_root:
        target_file = Path(workspace_root) / "logs" / "publishing_workspace.log"
    elif not target_file:
        target_file = Path("logs") / "publishing_workspace.log"

    if target_file:
        attach_file_handler(target_file, level=numeric)


def attach_file_handler(
    log_file: str | Path,
    level: int = logging.INFO,
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 5,
) -> None:
    """为根日志记录器附加 UTF-8 编码的滚动文件日志 Handler。"""
    try:
        path = Path(log_file).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            str(path),
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        logging.getLogger().addHandler(file_handler)
    except Exception as exc:
        logging.getLogger("publishing_workspace.logging").warning("无法初始化日志文件输出：%s", exc)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
