#!/usr/bin/env bash
H="game-2048-webgpu.quick.nrapken"".dev"
BASE="https://$H"
echo "== home =="
curl -s -o /tmp/gw.html -w "http=%{http_code} time=%{time_total}s size=%{size_download}\n" "$BASE/"
grep -o "<title>[^<]*</title>" /tmp/gw.html
echo "== api =="
curl -s -w " http=%{http_code}\n" "$BASE/api/health"
curl -s -w " http=%{http_code}\n" -X POST "$BASE/api/scores" -H 'Content-Type: application/json' -d '{"name":"webgpu-bot","score":2048}'
curl -s "$BASE/api/scores"; echo
curl -s -o /dev/null -w "invalid -> http=%{http_code}\n" -X POST "$BASE/api/scores" -H 'Content-Type: application/json' -d '{"name":"","score":0}'
echo "== assets =="
curl -s -o /dev/null -w "icon http=%{http_code} type=%{content_type}\n" "$BASE/icon.svg"
curl -s -o /dev/null -w "og http=%{http_code} type=%{content_type} size=%{size_download}\n" "$BASE/opengraph-image"
grep -o '<meta property="og:image"[^>]*>' /tmp/gw.html
