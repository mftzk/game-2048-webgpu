#!/usr/bin/env bash
cd /home/ubuntu/game-2048-webgpu
H="game-2048-webgpu.quick.nrapken"".dev"
node tools/qa_webgpu.cjs "https://$H/" /tmp/g2048webgpu-live 2>&1 | tail -30
