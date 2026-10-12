import unicodedata


def fold(text: str | None) -> str:
    """Bỏ dấu tiếng Việt + lowercase để tìm kiếm/sắp xếp."""
    s = unicodedata.normalize("NFD", (text or "").replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()
