FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY capflow_worker ./capflow_worker
RUN useradd --create-home capflow && chown -R capflow /app
USER capflow
ENV PATH="/app/.venv/bin:$PATH"
# Default: Celery worker with embedded beat. Override CMD for the API or the Redis-free loop.
CMD ["celery", "-A", "capflow_worker.tasks", "worker", "--beat", "--loglevel=INFO", "--concurrency=2"]
