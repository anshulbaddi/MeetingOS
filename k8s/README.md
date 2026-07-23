# MeetingOS — Kubernetes

## Prerequisites

```bash
# 1. KEDA (worker autoscaling from Redis queue depth)
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace

# 2. Nginx Ingress
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# 3. cert-manager (TLS)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace --set installCRDs=true
```

## Deploy order

```bash
kubectl apply -f k8s/namespace.yaml

# Populate secrets from your .env files (see secret.yaml for the full list)
kubectl create secret generic meetingos-secrets -n meetingos \
  --from-literal=DATABASE_URL="..." \
  --from-literal=OPENAI_API_KEY="..." \
  # ... (see secret.yaml)

kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/api.yaml
kubectl apply -f k8s/worker.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/ingress.yaml
```

## How autoscaling works

### API — CPU-based HPA
The API Deployment runs at 2 replicas and scales up to 6 when average CPU
crosses 70%. Scales down after a 2-minute stabilization window.

### Worker — KEDA queue-depth scaling
KEDA polls `LLEN celery` (the Celery task queue in Redis) every 15 seconds.
One worker pod is added for every 3 queued jobs:

| Queued jobs | Worker pods |
|-------------|-------------|
| 0           | 1 (minimum) |
| 6           | 2           |
| 15          | 5           |
| 30          | 10 (max)    |

`task_acks_late=True` in `celery_app.py` ensures tasks stay in the Redis list
until a worker finishes them — so the queue depth accurately reflects remaining
work even if a pod crashes mid-task (the task is re-queued automatically).

## Building images

The frontend requires `NEXT_PUBLIC_API_URL` at build time:

```bash
# Backend (api + worker share the same image)
docker build -t ghcr.io/anshulbaddi/meetingos-backend:latest ./backend
docker push ghcr.io/anshulbaddi/meetingos-backend:latest

# Frontend
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.meetingos.app \
  -t ghcr.io/anshulbaddi/meetingos-frontend:latest .
docker push ghcr.io/anshulbaddi/meetingos-frontend:latest
```

## Useful commands

```bash
# Watch pod scaling in real time
kubectl get pods -n meetingos -w

# Check KEDA ScaledObject status
kubectl describe scaledobject worker-scaledobject -n meetingos

# Manually inspect Celery queue depth
kubectl exec -n meetingos redis-0 -- redis-cli llen celery

# Tail worker logs across all replicas
kubectl logs -n meetingos -l app=worker -f --max-log-requests=10
```
