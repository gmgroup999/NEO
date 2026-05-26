-- Fix: ลบ FK constraint บน neo_ai_calls.session_id
-- session_id จาก browser เป็น random UUID ที่ไม่มีใน neo_sessions
-- ทำให้ logAICall fail ทุก call → usage/billing แสดง $0 ตลอด
ALTER TABLE neo_ai_calls
  DROP CONSTRAINT IF EXISTS neo_ai_calls_session_id_fkey;
