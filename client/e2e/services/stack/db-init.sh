#!/bin/sh
# The stack's database (compose.yaml), at its first start: the service's role, rows only once `carball-api migrate` has
# granted them, its password the stacks' secret
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v pw="$(cat /run/secrets/db_password)" <<'SQL'
CREATE ROLE carball_app LOGIN PASSWORD :'pw';
SQL
