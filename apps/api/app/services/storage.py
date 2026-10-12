"""Private object storage adapter.

Local disk is deliberately only a development fallback. Production sets
`S3_BUCKET`; database rows retain bucket/key/version metadata, never a URL.
"""

from pathlib import Path

from ..core.config import settings


def put_object(*, object_key: str, data: bytes, content_type: str) -> tuple[str, str | None, str | None]:
    if settings.s3_bucket:
        import boto3

        client = boto3.client("s3", region_name=settings.s3_region)
        result = client.put_object(Bucket=settings.s3_bucket, Key=object_key, Body=data, ContentType=content_type)
        return "S3", settings.s3_bucket, result.get("VersionId")
    path = Path(settings.upload_dir) / object_key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return "LOCAL", None, None


def read_url(*, storage: str, bucket: str | None, object_key: str) -> str:
    """Create a temporary URL only at read time for private S3 objects."""
    if storage == "S3":
        if not bucket:
            raise RuntimeError("S3 media is missing its bucket")
        import boto3

        return boto3.client("s3", region_name=settings.s3_region).generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": object_key}, ExpiresIn=300
        )
    return f"/uploads/{object_key}"


def media_view_url(media_id) -> str:
    """Build the API URL clients use to render a persisted media object.

    Never returns a filesystem path or a raw object key; the view endpoint
    resolves storage (local file or S3 presigned) at read time.
    """
    return f"/api/v1/media/{media_id}/view"
