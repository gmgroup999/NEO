#!/bin/bash
# RAID + Disk health monitor
# รัน cron ทุก 6 ชั่วโมง — แจ้ง Telegram ทันทีถ้า RAID degraded
# Weekly summary ทุกวันจันทร์ 08:xx

ENV_FILE="$HOME/neo/.env"
LOG_FILE="$HOME/logs/raid-monitor.log"
mkdir -p "$(dirname "$LOG_FILE")"

# อ่าน credentials จาก .env (ไม่มี quotes ใน values)
BOT_TOKEN=$(grep "^TELEGRAM_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
CHAT_ID=$(grep "^NEO_TELEGRAM_CHAT_ID=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "$(date '+%Y-%m-%d %H:%M'): ERROR - missing Telegram credentials (BOT_TOKEN or CHAT_ID not in $ENV_FILE)" >> "$LOG_FILE"
  exit 1
fi

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=$1" \
    -d "parse_mode=Markdown" \
    -m 10 > /dev/null 2>&1
}

# ตรวจ RAID status จาก /proc/mdstat
DEGRADED=0
ISSUES=""
while IFS= read -r line; do
  if echo "$line" | grep -qE "^md[0-9]+"; then
    ARRAY=$(echo "$line" | awk '{print $1}')
    STATUS_BRACKET=$(echo "$line" | grep -oE "\[[U_]+\]")
    if echo "$STATUS_BRACKET" | grep -q "_"; then
      DEGRADED=1
      ISSUES="${ISSUES}  ❌ ${ARRAY}: ${STATUS_BRACKET} DEGRADED\n"
    elif echo "$line" | grep -qiE "inactive|failed|removed"; then
      DEGRADED=1
      ISSUES="${ISSUES}  ❌ ${ARRAY}: FAILED/INACTIVE\n"
    fi
  fi
done < /proc/mdstat

HOST=$(hostname)
DATE=$(date '+%Y-%m-%d %H:%M')
DISK_USED=$(df -h / | awk 'NR==2 {print $3"/"$2" ("$5")"}')

if [ "$DEGRADED" -eq 1 ]; then
  MSG="🚨 RAID ALERT — ${HOST}
${DATE}

พบ array เสียหาย:
${ISSUES}
ตรวจสอบด่วน:
ssh jack@z-node.cc
cat /proc/mdstat
mdadm --detail /dev/md2"
  send_telegram "$MSG"
  echo "$(date '+%Y-%m-%d %H:%M'): ALERT sent — degraded array" >> "$LOG_FILE"
else
  # Weekly OK summary ทุกวันจันทร์ช่วง 08:xx
  DOW=$(date +%u)
  HOUR=$(date +%H)
  if [ "$DOW" -eq 1 ] && [ "$HOUR" -eq 8 ]; then
    MSG="✅ RAID Weekly OK — ${HOST}
${DATE}

md0 md1 md2: [UU] ทุก array สมบูรณ์
Disk: ${DISK_USED}"
    send_telegram "$MSG"
    echo "$(date '+%Y-%m-%d %H:%M'): Weekly OK summary sent" >> "$LOG_FILE"
  fi
fi
