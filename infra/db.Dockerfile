# PostGIS + pgvector in one image — Faz A needs both extensions available in
# the same database (merchant locations/warehouses use geography(Point,4326),
# agent_memories.embedding uses vector(1536)).
FROM postgis/postgis:16-3.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
