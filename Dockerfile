# renfe-mcp requires >=3.12. Do not drop this back to 3.11.
FROM python:3.12-slim

# git is needed because requirements.txt installs the Renfe scraper from GitHub.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces runs containers as a non-root user with uid 1000.
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Both modules. app.py imports geo, so omitting it fails at startup, not build.
COPY --chown=user app.py geo.py .

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
