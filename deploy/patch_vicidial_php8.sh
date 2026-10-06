#!/bin/bash
# EnVoip System: arreglos de Vicidial para PHP 8 (ViciBox 12). Idempotente; deploy.sh lo ejecuta en cada despliegue.
#
# vdc_db_query.php: al terminar una llamada que el cliente colgó muy pronto, la pantalla del agente envía start_epoch
# vacío; «ahora - ""» es un error fatal en PHP 8 (500), la pantalla clásica deja de procesar órdenes y el agente se
# queda atascado: no puede calificar, colgar ni pausar hasta cerrar sesión.
set -u
F=/srv/www/htdocs/agc/vdc_db_query.php
[ -f "$F" ] || { echo "  (no está $F: nada que parchear)"; exit 0; }
OLD='$length_in_sec = ($StarTtime - $start_epoch);'
if grep -qF "$OLD" "$F"; then
  T=$(mktemp)
  sed 's/\$length_in_sec = (\$StarTtime - \$start_epoch);/$length_in_sec = (is_numeric($start_epoch) ? ($StarTtime - $start_epoch) : 0);/' "$F" > "$T"
  if php -l "$T" >/dev/null 2>&1; then
    cp -p "$F" "$F.bak-envoip-$(date +%Y%m%d%H%M)"
    cat "$T" > "$F"
    echo "  vdc_db_query.php: corregido start_epoch vacío (PHP 8)"
  else
    echo "  vdc_db_query.php: el parche no supera php -l; no se aplica" >&2
  fi
  rm -f "$T"
else
  echo "  vdc_db_query.php: ya corregido"
fi
