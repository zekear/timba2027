#!/usr/bin/env bash
# Quick health check del soak test. Run desde el dir del proyecto.
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER=$(which docker)

echo "═══════════════════════════════════════════"
echo "  POLITICA SOAK TEST — STATUS"
echo "  $(date)"
echo "═══════════════════════════════════════════"

echo ""
echo "── Procesos ──"
ps aux | grep -E "(next start|tsx.*orchestrator)" | grep -v grep | awk '{print $2, $10, "elapsed:", $11}' || echo "  ⚠ procesos no encontrados"

echo ""
echo "── DB counts ──"
$DOCKER exec politica-pg psql -U politica -d politica -tA -c "
SELECT format('  markets:        %s', COUNT(*)) FROM markets
UNION ALL SELECT format('  market_prices:  %s', COUNT(*)) FROM market_prices
UNION ALL SELECT format('  news (total):   %s', COUNT(*)) FROM news
UNION ALL SELECT format('  news (tagged):  %s', COUNT(*)) FROM news WHERE tagged_at IS NOT NULL
UNION ALL SELECT format('  polls:          %s', COUNT(*)) FROM polls
UNION ALL SELECT format('  events pending: %s', COUNT(*)) FROM events WHERE status = 'pending'
UNION ALL SELECT format('  events processed: %s', COUNT(*)) FROM events WHERE status = 'processed'
UNION ALL SELECT format('  bot_posts (draft):     %s', COUNT(*)) FROM bot_posts WHERE status = 'draft'
UNION ALL SELECT format('  bot_posts (approved):  %s', COUNT(*)) FROM bot_posts WHERE status = 'approved'
UNION ALL SELECT format('  bot_posts (scheduled): %s', COUNT(*)) FROM bot_posts WHERE status = 'scheduled'
UNION ALL SELECT format('  bot_posts (published): %s', COUNT(*)) FROM bot_posts WHERE status = 'published'
UNION ALL SELECT format('  bot_posts (killed):    %s', COUNT(*)) FROM bot_posts WHERE status = 'killed'
"

echo ""
echo "── Worker last 5 lines ──"
tail -5 /tmp/soak-worker.log 2>/dev/null | sed 's/^/  /' || echo "  ⚠ /tmp/soak-worker.log no existe"

echo ""
echo "── Web last 5 lines ──"
tail -5 /tmp/soak-web.log 2>/dev/null | sed 's/^/  /' || echo "  ⚠ /tmp/soak-web.log no existe"

echo ""
echo "── Errores recientes en worker (último día) ──"
ERRORS=$(grep -E '(ERROR|FATAL|"level":50|"level":60)' /tmp/soak-worker.log 2>/dev/null | tail -10)
if [ -z "$ERRORS" ]; then
  echo "  ✓ sin errores"
else
  echo "$ERRORS" | sed 's/^/  /'
fi

echo ""
echo "── Storage cards count ──"
ls "$PROJECT_ROOT/storage/cards/" 2>/dev/null | wc -l | awk '{printf "  %s PNGs en storage/cards/\n", $1}'

echo ""
echo "═══════════════════════════════════════════"
