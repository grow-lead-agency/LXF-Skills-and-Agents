# Docker Networking + Volume Strategies

## Table of Contents
1. [Network Drivers Overview](#drivers)
2. [Bridge Networks](#bridge)
3. [Host Network](#host)
4. [Overlay Networks (Swarm)](#overlay)
5. [Macvlan / IPvlan](#macvlan)
6. [DNS and Container Discovery](#dns)
7. [Port Mapping Strategies](#ports)
8. [Volume Types](#volumes)
9. [Volume Patterns by Use Case](#patterns)
10. [Backup and Restore Volumes](#backup)

---

## Network Drivers Overview {#drivers}

| Driver | When to use |
|--------|------------|
| `bridge` | Default. Single-host containers. Most common. |
| `host` | Max performance, no isolation. Linux only. |
| `overlay` | Multi-host Swarm communication. |
| `macvlan` | Container needs its own MAC/IP on LAN. IoT, legacy apps. |
| `ipvlan` | Like macvlan, but shared MAC address. |
| `none` | Completely isolated. For batch jobs, security-sensitive tasks. |

---

## Bridge Networks {#bridge}

Default bridge vs user-defined bridge:

```bash
# Default bridge (docker0) — avoid for production
# - No DNS by service name
# - All containers can communicate
docker run myapp:latest  # uses default bridge

# User-defined bridge — use this
docker network create myapp-network

docker run --network myapp-network --name app myapp:latest
docker run --network myapp-network --name db postgres:16
# Now 'app' can reach 'db' at hostname 'db'
```

**Key differences:**
- User-defined bridges have automatic DNS by container name
- User-defined bridges provide better isolation
- Containers can be added/removed from user-defined bridges at runtime

```bash
# Create network with custom subnet
docker network create \
  --driver bridge \
  --subnet 172.20.0.0/16 \
  --ip-range 172.20.240.0/20 \
  --gateway 172.20.0.1 \
  myapp-network

# Inspect network
docker network inspect myapp-network

# Connect running container to network
docker network connect myapp-network my-container

# Disconnect
docker network disconnect myapp-network my-container

# List networks
docker network ls

# Remove unused networks
docker network prune
```

### Multiple Networks (Service Isolation)

```bash
# Create isolated networks
docker network create frontend-net
docker network create backend-net
docker network create db-net

# Frontend: only frontend-net
docker run --network frontend-net --name nginx myapp-nginx:latest

# App: frontend + backend
docker run --name app myapp:latest
docker network connect frontend-net app
docker network connect backend-net app

# Database: only db-net (not exposed to frontend)
docker run --network db-net --name postgres postgres:16-alpine
docker network connect db-net app
```

In Compose (preferred approach):
```yaml
services:
  nginx:
    networks: [frontend]
  app:
    networks: [frontend, backend]
  postgres:
    networks: [backend]  # app reaches pg, nginx can't

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
    internal: true  # no outbound internet from backend net
```

---

## Host Network {#host}

Container shares the host's network stack — no network isolation, best performance.

```bash
docker run --network host myapp:latest
# App listens on port 3000 → accessible at host:3000 directly
# No port mapping needed (or possible)
```

```yaml
# compose.yml
services:
  app:
    network_mode: host
```

**Use when:**
- Performance-critical networking (high-throughput, low-latency)
- App needs to bind to specific host interfaces
- Monitoring agents that need host network visibility

**Avoid when:**
- Multiple containers need same port (conflicts)
- Security isolation is needed
- macOS or Windows (host networking not fully supported on Desktop)

---

## Overlay Networks (Swarm) {#overlay}

For multi-host communication in Docker Swarm.

```bash
# Create overlay network (requires Swarm init)
docker swarm init

docker network create \
  --driver overlay \
  --attachable \  # allows non-swarm containers to attach
  myapp-overlay

# Services in same overlay network can communicate across hosts
docker service create \
  --name app \
  --network myapp-overlay \
  myapp:latest

docker service create \
  --name db \
  --network myapp-overlay \
  postgres:16
```

**Not needed if using Coolify/Kubernetes** — they manage their own networking.

---

## Macvlan / IPvlan {#macvlan}

Container gets its own IP address on your physical LAN.

```bash
# Macvlan: container appears as physical device on LAN
docker network create \
  --driver macvlan \
  --subnet 192.168.1.0/24 \
  --gateway 192.168.1.1 \
  --opt parent=eth0 \
  macvlan-net

docker run --network macvlan-net --ip 192.168.1.200 myapp:latest
# Container reachable at 192.168.1.200 on local network
```

**Use case:** IoT devices, legacy applications that need specific IP, network appliances.
Not typically needed for web services — use bridge + reverse proxy instead.

---

## DNS and Container Discovery {#dns}

### Service Discovery by Name

```bash
# In user-defined network, containers resolve by name
docker network create mynet
docker run -d --name db --network mynet postgres:16
docker run --rm --network mynet alpine ping db  # works!
docker run --rm --network mynet alpine nslookup db  # resolves!
```

### Custom DNS Configuration

```yaml
# compose.yml
services:
  app:
    dns:
      - 8.8.8.8
      - 8.8.4.4
    dns_search:
      - mycompany.internal
    dns_opt:
      - use-vc  # use TCP for DNS
    extra_hosts:
      - "host.docker.internal:host-gateway"  # access host from container
      - "myservice.local:192.168.1.100"       # custom hostname mapping
```

### Accessing Host from Container

```yaml
# Modern approach (Docker 20.10+)
services:
  app:
    extra_hosts:
      - "host.docker.internal:host-gateway"
# Now app can reach host at host.docker.internal:PORT
```

### Container Network Debugging

```bash
# Inspect container's network config
docker inspect --format='{{json .NetworkSettings.Networks}}' mycontainer

# Run busybox for debugging
docker run --rm --network myapp-network busybox nslookup db
docker run --rm --network myapp-network busybox wget -qO- http://app:3000/health

# Check DNS resolution inside container
docker exec mycontainer cat /etc/resolv.conf
docker exec mycontainer nslookup postgres

# Check open ports inside container
docker exec mycontainer ss -tlnp
docker exec mycontainer netstat -tlnp  # if netstat available
```

---

## Port Mapping Strategies {#ports}

```yaml
services:
  app:
    ports:
      # host:container
      - "3000:3000"                   # all interfaces (0.0.0.0:3000)
      - "127.0.0.1:3000:3000"         # localhost only (more secure)
      - "0.0.0.0:3000:3000"           # explicit all interfaces

      # Ephemeral host port (OS assigns)
      - "3000"                        # random host port → find with docker ps

      # Port range
      - "8000-8010:8000-8010"

      # UDP
      - "5353:5353/udp"
      - "5353:5353/tcp"
```

**Recommendation:** In production with a reverse proxy (Traefik/nginx), bind app ports
to `127.0.0.1` only. The proxy exposes port 80/443 to the world.

```yaml
# Production: app not directly accessible
app:
  ports:
    - "127.0.0.1:3000:3000"

# Traefik handles external access
traefik:
  ports:
    - "80:80"
    - "443:443"
  labels:
    - "traefik.http.routers.app.rule=Host(`myapp.com`)"
```

---

## Volume Types {#volumes}

| Type | Description | Persists? | Use for |
|------|-------------|-----------|---------|
| Named volume | Docker-managed, stored in `/var/lib/docker/volumes/` | Yes | Production data |
| Bind mount | Specific host path | Yes (on host) | Dev hot-reload, config files |
| tmpfs | In-memory only | No | Temp files, secrets at runtime |
| Anonymous volume | Like named but no name | Until container removed | Ephemeral scratch |

```yaml
volumes:
  # Named volume — Docker manages location
  db_data:

  # Bind mount — you choose location
  # (defined inline in service, not in top-level volumes)

services:
  db:
    volumes:
      - db_data:/var/lib/postgresql/data     # named volume

  app:
    volumes:
      - ./src:/app/src                       # bind mount (dev)
      - /app/node_modules                    # anonymous (prevents host override)
      - type: tmpfs                          # tmpfs
        target: /tmp
        tmpfs:
          size: 100m
```

---

## Volume Patterns by Use Case {#patterns}

### Database Persistence (Production)

```yaml
volumes:
  postgres_data:
    driver: local
    labels:
      backup: "true"  # custom label for backup scripts

services:
  postgres:
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

### Shared Data Between Containers

```yaml
volumes:
  shared_uploads:

services:
  api:
    volumes:
      - shared_uploads:/app/uploads

  thumbnail-worker:
    volumes:
      - shared_uploads:/uploads:ro  # read-only for worker
```

### Development with Hot Reload

```yaml
services:
  app:
    volumes:
      - ./src:/app/src              # sync source
      - ./public:/app/public        # sync static assets
      - /app/node_modules           # CRITICAL: prevent host modules from overriding
      # Without /app/node_modules, host's node_modules (built for macOS) would
      # override the container's node_modules (built for Linux) → native modules break
```

### Configuration Files (Read-only Mounts)

```yaml
services:
  nginx:
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/ssl/certs:ro

  app:
    volumes:
      - ./config/app.json:/app/config.json:ro
```

---

## Backup and Restore Volumes {#backup}

### Backup Named Volume

```bash
# Backup to tar.gz on host
docker run --rm \
  -v myapp_db_data:/data:ro \
  -v $(pwd)/backups:/backup \
  alpine \
  tar czf /backup/db_backup_$(date +%Y%m%d_%H%M%S).tar.gz -C /data .

# Or use docker cp equivalent
docker run --rm \
  -v myapp_db_data:/source:ro \
  busybox \
  tar -C /source -czf - . > db_backup.tar.gz
```

### Restore Named Volume

```bash
# Create volume if it doesn't exist
docker volume create myapp_db_data

# Restore from backup
docker run --rm \
  -v myapp_db_data:/data \
  -v $(pwd)/backups:/backup:ro \
  alpine \
  tar xzf /backup/db_backup_20260101_120000.tar.gz -C /data

# Alternative with cat
cat db_backup.tar.gz | docker run --rm -i \
  -v myapp_db_data:/data \
  alpine \
  tar xzf - -C /data
```

### Postgres-specific Backup

```bash
# Dump inside container
docker compose exec postgres \
  pg_dump -U postgres myapp > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T postgres \
  psql -U postgres myapp < backup_20260101.sql

# With pg_dump compression
docker compose exec postgres \
  pg_dump -U postgres -Fc myapp > backup.dump

docker compose exec -T postgres \
  pg_restore -U postgres -d myapp < backup.dump
```

### Inspect and Manage Volumes

```bash
# List volumes
docker volume ls

# Filter by label
docker volume ls --filter label=backup=true

# Inspect volume (find host path)
docker volume inspect myapp_db_data
# Shows: Mountpoint: /var/lib/docker/volumes/myapp_db_data/_data

# Remove specific volume
docker volume rm myapp_db_data

# Remove all unused volumes (CAUTION!)
docker volume prune

# Remove volumes not used by stopped containers
docker volume prune --filter "label!=backup=true"
```
