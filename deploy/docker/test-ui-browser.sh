#!/usr/bin/env bash
# Browser checks for the web UI against the throwaway test stack
# (deploy/docker/docker-compose.test.yml), using the Playwright Docker image.
#
#   docker compose -f deploy/docker/docker-compose.test.yml up -d --build
#   PCP_UI_OUT=/tmp/pcp-ui PCP_PLAYWRIGHT_MODULES=<dir-or-volume> deploy/docker/test-ui-browser.sh
#
# It seeds two signed-in users straight into the test database (an admin and
# a plain member; random cookie values, only their SHA-256 is stored, exactly
# like a Casdoor login), a topic, three sessions and a project, then runs
# deploy/docker/test-ui-browser.mjs inside the app container's network
# namespace so the browser talks to http://localhost:3000 (a secure context,
# which `__Host-` cookies need). Nothing is published beyond the stack's own
# loopback port. Screenshots go to $PCP_UI_OUT.
#
# PCP_PLAYWRIGHT_MODULES is a Docker volume or host directory containing
# node_modules/playwright-core at the image's version, e.g. created once with
#   docker run --rm -v pcp-pw:/pw -w /pw <image> sh -c 'npm init -y && npm i playwright-core@1.58.2'
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
PROJECT=${PCP_TEST_PROJECT:-pcp-test}
APP="${PROJECT}-app-1"
DB="${PROJECT}-db-1"
OUT=${PCP_UI_OUT:?set PCP_UI_OUT to a directory for screenshots}
PW_IMAGE=${PCP_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.58.2-noble}
PW_MODULES=${PCP_PLAYWRIGHT_MODULES:?set PCP_PLAYWRIGHT_MODULES (see header)}
mkdir -p "$OUT"

rand() { head -c 32 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-43; }
sha() { printf %s "$1" | sha256sum | cut -d' ' -f1; }
ADMIN_SESSION=$(rand); ADMIN_CSRF=$(rand); MEMBER_SESSION=$(rand); MEMBER_CSRF=$(rand)

psql_test() { docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -q -U pcp -d pcp; }
# The app creates its schema on the first setup probe; make sure it exists.
timeout 30 curl -fsS "http://127.0.0.1:${PCP_TEST_PORT:-3100}/api/v1/setup/status" >/dev/null
psql_test <<SQL
INSERT INTO users (id, oidc_issuer, oidc_sub, display_name, is_admin) VALUES
  ('usr_ui_admin', 'https://idp.test', 'ui-admin', 'UI Admin', true),
  ('usr_ui_member', 'https://idp.test', 'ui-member', 'UI Member', false)
ON CONFLICT (id) DO NOTHING;
DELETE FROM web_sessions WHERE user_id IN ('usr_ui_admin', 'usr_ui_member');
INSERT INTO web_sessions (id_hash, user_id, csrf_hash, expires_at) VALUES
  ('$(sha "$ADMIN_SESSION")', 'usr_ui_admin', '$(sha "$ADMIN_CSRF")', now() + interval '1 hour'),
  ('$(sha "$MEMBER_SESSION")', 'usr_ui_member', '$(sha "$MEMBER_CSRF")', now() + interval '1 hour');
INSERT INTO topics (id, title) VALUES ('top_ui', 'UI topic') ON CONFLICT (id) DO NOTHING;
INSERT INTO sessions (id, topic_id, title, owner_user_id, class) VALUES
  ('ses_ui_owned', 'top_ui', 'Member owned session', 'usr_ui_member', 'trusted'),
  ('ses_ui_admin', NULL, 'Unowned admin-only session', NULL, 'unattributed'),
  ('ses_ui_project', NULL, 'Project session', NULL, 'unattributed')
ON CONFLICT (id) DO NOTHING;
SQL
# Projects exist from migration 013 on; seed one when the table is there.
if docker exec "$DB" psql -U pcp -d pcp -Atc "SELECT to_regclass('public.projects') IS NOT NULL" | grep -qx t; then
  psql_test <<SQL
INSERT INTO projects (id, canonical_key, display_name, git_remotes_json) VALUES
  ('prj_ui', 'git:github.com/example/circtime', 'circtime', '["github.com/example/circtime"]')
ON CONFLICT (id) DO NOTHING;
INSERT INTO project_workspaces (id, project_id, device_id, device_label, device_kind, directory, default_branch, last_seen_at) VALUES
  ('pws_ui_win', 'prj_ui', 'win-00000000', 'Windows desktop', 'windows', 'D:/Documents/Github/circtime', 'main', now()),
  ('pws_ui_claw', 'prj_ui', 'openclaw-gateway', 'OpenClaw gateway', 'openclaw-container', '/home/node/.openclaw/workspace/git/circtime', 'main', now())
ON CONFLICT (id) DO NOTHING;
UPDATE sessions SET project_id = 'prj_ui', context_title = 'Deploy page via GitHub Actions' WHERE id = 'ses_ui_project';
SQL
fi

docker run --rm --network "container:${APP}" --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e PCP_UI_BASE=http://localhost:3000 \
  -e PCP_UI_ADMIN_SESSION="$ADMIN_SESSION" -e PCP_UI_ADMIN_CSRF="$ADMIN_CSRF" \
  -e PCP_UI_MEMBER_SESSION="$MEMBER_SESSION" -e PCP_UI_MEMBER_CSRF="$MEMBER_CSRF" \
  -v "$PW_MODULES:/pw:ro" -e NODE_PATH=/pw/node_modules \
  -v "$PWD/deploy/docker/test-ui-browser.mjs:/checks/test-ui-browser.mjs:ro" -v "$OUT:/out" \
  "$PW_IMAGE" node /checks/test-ui-browser.mjs
