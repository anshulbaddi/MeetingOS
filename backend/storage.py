import os
import tempfile
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from typing import Optional

_s3_client = None

# Use local filesystem when S3_ENDPOINT_URL is not configured.
_LOCAL_ROOT = Path(__file__).parent / "uploads"


def _use_local() -> bool:
    return not os.environ.get("S3_ENDPOINT_URL", "").strip()


def _get_s3():
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.client import Config

        _s3_client = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT_URL"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    return _s3_client


def _bucket() -> str:
    return os.environ["S3_BUCKET_NAME"]


def get_public_url(object_key: str) -> Optional[str]:
    """
    Returns a CDN URL for the given object key if R2_PUBLIC_URL is configured,
    otherwise None. The public URL comes from enabling r2.dev (or a custom
    domain) on the R2 bucket in the Cloudflare dashboard.
    """
    base = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")
    if not base:
        return None
    return f"{base}/{object_key}"


def upload(file_bytes: bytes, object_key: str, content_type: str = "application/octet-stream") -> str:
    if _use_local():
        path = _LOCAL_ROOT / object_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(file_bytes)
    else:
        _get_s3().put_object(
            Bucket=_bucket(),
            Key=object_key,
            Body=file_bytes,
            ContentType=content_type,
        )
    return object_key


def download_bytes(object_key: str) -> bytes:
    if _use_local():
        return (_LOCAL_ROOT / object_key).read_bytes()
    response = _get_s3().get_object(Bucket=_bucket(), Key=object_key)
    return response["Body"].read()


def download_fileobj(object_key: str) -> BytesIO:
    buf = BytesIO(download_bytes(object_key))
    buf.name = object_key.split("/")[-1]
    return buf


@contextmanager
def download_tempfile(object_key: str):
    ext = "." + object_key.rsplit(".", 1)[-1] if "." in object_key else ""
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(download_bytes(object_key))
        tmp_path = f.name
    try:
        yield tmp_path
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
