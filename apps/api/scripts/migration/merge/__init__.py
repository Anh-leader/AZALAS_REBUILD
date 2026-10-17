"""Chiến lược merge Supabase OLD (source of truth) -> Supabase NEW, bổ sung từ Google Sheets.

Supabase OLD thắng khi conflict; Sheets chỉ điền field null/empty hoặc thêm record
chưa có. Không downgrade status; không overwrite số liệu tài chính.
"""
