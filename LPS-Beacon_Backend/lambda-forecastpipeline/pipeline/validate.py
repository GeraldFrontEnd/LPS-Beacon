"""Stage 1: validate an uploaded file before anything parses it.

Uploaded files are untrusted. The upload Lambda only knows the declared file
type, and a pre-signed PUT cannot enforce a size limit, so the checks happen here:
extension, real size, real content type (first bytes), zip-bomb limits and macros.
A failed file is copied to quarantine/ with a reason file; raw/ is left as it is.
"""
from __future__ import annotations

import datetime as dt
import io
import zipfile

from .config import Config
from .s3io import Store

READABLE = {".csv", ".tsv", ".txt", ".xlsx", ".xlsm"}
# The upload Lambda also accepts these, but the Lambda layer has no reader for them.
NEEDS_CONVERSION = {".xls", ".xlsb", ".ods"}

ZIP_MAX_UNCOMPRESSED = 200 * 1024 * 1024   # 200 MB once unzipped
ZIP_MAX_RATIO = 100                         # unzipped size / zipped size
ZIP_MAX_MEMBERS = 2000


class Rejected(Exception):
    """The file must not be processed. The message is shown to the uploader."""


def extension(key: str) -> str:
    name = key.rsplit("/", 1)[-1]
    return "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _check_zip(data: bytes, allow_macros: bool) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise Rejected("the file says it is Excel but is not a valid .xlsx archive") from exc
    infos = archive.infolist()
    if len(infos) > ZIP_MAX_MEMBERS:
        raise Rejected("the workbook contains too many internal parts")
    total = sum(info.file_size for info in infos)
    if total > ZIP_MAX_UNCOMPRESSED or total > ZIP_MAX_RATIO * max(len(data), 1):
        raise Rejected("the workbook expands to an unsafe size (possible zip bomb)")
    names = {info.filename for info in infos}
    if "[Content_Types].xml" not in names or not any(n.startswith("xl/") for n in names):
        raise Rejected("the archive is not an Excel workbook")
    if not allow_macros and any(n.lower().endswith("vbaproject.bin") for n in names):
        raise Rejected("the workbook contains macros; save it as .xlsx and upload again")


def _check_text(data: bytes) -> None:
    sample = data[:65536]
    if b"\x00" in sample:
        raise Rejected("the file says it is text/CSV but contains binary data")
    if sample[:2] == b"PK" or sample[:4] == b"\xd0\xcf\x11\xe0":
        raise Rejected("the file is an Excel workbook saved with a .csv/.txt name")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            sample.decode(encoding)
            return
        except UnicodeDecodeError:
            continue
    raise Rejected("the text file is not UTF-8 or Windows-1252 encoded")


def run(cfg: Config, store: Store, key: str) -> bytes:
    """Returns the file bytes if the file is safe to parse, otherwise raises Rejected."""
    ext = extension(key)
    if ext in NEEDS_CONVERSION:
        raise Rejected(f"{ext} files cannot be read by the pipeline; save as .xlsx or .csv")
    if ext not in READABLE:
        raise Rejected(f"file type {ext or '(none)'} is not allowed")

    size = store.size(key)
    if size == 0:
        raise Rejected("the file is empty")
    if size > cfg.max_upload_mb * 1024 * 1024:
        raise Rejected(f"the file is {size / 1048576:.1f} MB; the limit is {cfg.max_upload_mb} MB")

    data = store.read_bytes(key)
    if ext in (".xlsx", ".xlsm"):
        if data[:2] != b"PK":
            raise Rejected("the file says it is Excel but its content is not")
        _check_zip(data, cfg.allow_macro_files)
    else:
        _check_text(data)
    return data


def quarantine(store: Store, key: str, reason: str) -> str:
    """Copies the file to quarantine/ and writes <file>.reason.json next to it."""
    target = "quarantine/" + key.split("/", 1)[1] if key.startswith("raw/") else "quarantine/" + key
    try:
        store.write_bytes(target, store.read_bytes(key))
    except Exception:  # noqa: BLE001 - the reason file below still records the rejection
        pass
    store.write_json(target + ".reason.json", {
        "sourceKey": key,
        "reason": reason,
        "quarantinedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    })
    return target
